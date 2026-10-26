import 'dart:async';
import 'package:flutter/material.dart';
import 'api.dart';
import 'models.dart';

class Sample {
  Sample(this.time, this.reading);
  final DateTime time;
  final Map<String, double> reading;
}

class AppModel extends ChangeNotifier {
  AppModel({ApiClient? api, SessionStore? store}) : api = api ?? ApiClient(), store = store ?? const SecureSessionStore();
  final ApiClient api;
  final SessionStore store;
  Account? user;
  List<Room> rooms = [];
  List<AlertItem> alerts = [];
  List<Account> accounts = [];
  List<Map<String, dynamic>> recipients = [];
  final Map<int, List<Sample>> samples = {};
  final Map<String, Map<String, dynamic>> roomDrafts = {};
  Map<String, Limit> limits = {'temp': const Limit(30, 32), 'hum': const Limit(65, 75), 'co2': const Limit(1000, 1200)};
  String fanTrigger = 'exceeded', syncError = '', startupError = '';
  ThemeMode themeMode = ThemeMode.system;
  int? selectedRoomId;
  int unread = 0, _latestAlert = 0, _generation = 0;
  bool initialized = false, loading = true, _polling = false, _disposed = false;
  Timer? _timer;
  bool get isAdmin => user?.isAdmin == true;
  Room? get room => rooms.isEmpty ? null : rooms.firstWhere((r) => r.id == selectedRoomId, orElse: () => rooms.first);
  void _notify() { if (!_disposed) notifyListeners(); }
  Future<void> initialize() async {
    if (initialized) return;
    initialized = true;
    try {
      final theme = await store.read('safezone.flutter.theme');
      themeMode = ThemeMode.values.firstWhere((m) => m.name == theme, orElse: () => ThemeMode.system);
      api.token = await store.read('safezone.flutter.token') ?? '';
      if (api.token.isNotEmpty) {
        final me = await api.request('/auth/me');
        user = Account.fromJson(object(me['user']));
        await refresh();
        resume();
      }
    } catch (e) {
      startupError = '$e'; user = null;
      if (e is ApiException && e.status == 401) { api.token = ''; await store.delete('safezone.flutter.token'); }
    } finally { loading = false; _notify(); }
  }
  Future<Map<String, dynamic>> call(String path, {String method = 'GET', Map<String, dynamic>? body}) async {
    final token = api.token;
    try { return await api.request(path, method: method, body: body); }
    on ApiException catch (e) {
      if (e.status == 401 && token.isNotEmpty && api.token == token && path != '/auth/change-password') await logout();
      rethrow;
    }
  }
  Future<void> login(String identifier, String password, bool admin) async {
    final result = await api.request('/auth/login', method: 'POST', body: {'identifier': identifier.trim(), 'password': password, 'as': admin ? 'admin' : 'viewer'});
    api.token = '${result['token']}';
    user = Account.fromJson(object(result['user']));
    selectedRoomId = null; _latestAlert = 0; unread = 0; startupError = '';
    await store.write('safezone.flutter.token', api.token);
    try { await refresh(); resume(); }
    catch (_) { user = null; _notify(); rethrow; }
    _notify();
  }
  Future<void> refresh() async {
    final generation = _generation;
    final response = await Future.wait([call('/simulation'), call('/alerts'), call('/settings')]);
    if (generation != _generation || user == null) return;
    _apply(response[0], response[1]);
    if (isAdmin) await refreshAdmin();
    syncError = ''; _notify();
  }
  Future<void> refreshAdmin() async {
    if (!isAdmin) return;
    final generation = _generation;
    final result = await Future.wait([call('/admin/users'), call('/sms-recipients')]);
    if (generation != _generation || !isAdmin) return;
    accounts = [...array(result[0]['admins']), ...array(result[0]['viewers'])].map((u) => Account.fromJson(object(u))).toList();
    recipients = array(result[1]['recipients']).map(object).toList();
    _notify();
  }
  void _apply(Map<String, dynamic> shared, Map<String, dynamic> messages) {
    rooms = array(shared['rooms']).map((r) => Room.fromJson(object(r))).toList()..sort((a,b) => a.roomNo.compareTo(b.roomNo));
    if (!rooms.any((r) => r.id == selectedRoomId)) selectedRoomId = rooms.isEmpty ? null : rooms.first.id;
    limits = object(shared['thresholds']).map((k,v) => MapEntry(k, Limit.fromJson(v)));
    fanTrigger = '${shared['fanTrigger'] ?? 'exceeded'}';
    for (final r in rooms) {
      final history = samples.putIfAbsent(r.id, () => []);
      if (history.isEmpty || history.last.time != r.updatedAt) history.add(Sample(r.updatedAt, Map.of(r.reading)));
      if (history.length > 200) history.removeRange(0, history.length - 200);
    }
    samples.removeWhere((id, _) => !rooms.any((r) => r.id == id));
    alerts = array(messages['alerts']).map(AlertItem.fromJson).toList();
    if (_latestAlert > 0) unread += alerts.where((a) => a.id > _latestAlert).length;
    for (final a in alerts) { if (a.id > _latestAlert) _latestAlert = a.id; }
  }
  Future<void> poll() async {
    if (_polling || user == null) return;
    _polling = true;
    final generation = _generation;
    try {
      final result = await Future.wait([call('/simulation'), call('/alerts')]);
      if (generation != _generation || user == null) return;
      _apply(result[0], result[1]); syncError = ''; _notify();
    } catch (e) { if (generation == _generation && user != null) { syncError = '$e'; _notify(); } }
    finally { _polling = false; }
  }
  void pause() { _timer?.cancel(); _timer = null; }
  void resume() { pause(); if (user != null) _timer = Timer.periodic(const Duration(seconds: 2), (_) => poll()); }
  void selectRoom(int id) { if (rooms.any((r) => r.id == id)) { selectedRoomId = id; _notify(); } }
  void readAlerts() { unread = 0; }
  Future<void> setTheme(ThemeMode value) async { themeMode = value; _notify(); await store.write('safezone.flutter.theme', value.name); }
  Future<void> mutate(String path, {String method = 'POST', required Map<String, dynamic> body}) async {
    await call(path, method: method, body: body); await refresh();
  }
  Future<void> changePassword(String current, String next) async {
    final result = await call('/auth/change-password', method: 'POST', body: {'currentPassword': current, 'newPassword': next});
    api.token = '${result['token']}'; await store.write('safezone.flutter.token', api.token);
  }
  Future<void> updateEmail(String email) async {
    final result = await call('/auth/me/email', method: 'PUT', body: {'email': email});
    user = Account.fromJson(object(result['user'])); _notify();
  }
  Future<void> logout() async {
    _generation++; pause(); api.token = ''; user = null; rooms = []; alerts = []; accounts = []; recipients = [];
    samples.clear(); roomDrafts.clear(); selectedRoomId = null; unread = 0; _latestAlert = 0; syncError = ''; startupError = '';
    _notify(); await store.delete('safezone.flutter.token');
  }
  @override
  void dispose() { _disposed = true; pause(); api.close(); super.dispose(); }
}
