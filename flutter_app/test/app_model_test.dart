import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:safezone_flutter/data/api.dart';
import 'package:safezone_flutter/data/app_model.dart';
import 'package:safezone_flutter/data/models.dart';
import 'package:safezone_flutter/ui/widgets.dart';

class MemoryStore implements SessionStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async { values[key] = value; }
  @override
  Future<void> delete(String key) async { values.remove(key); }
}

const adminJson = {'id': 1, 'role': 'admin', 'kind': 'faculty', 'username': 'admin', 'fullName': 'Test Administrator', 'email': 'test@pup.edu.ph', 'phone': '09171234567'};
Map<String, dynamic> roomJson(int id, int roomNo) => {
  'id': id, 'name': 'Room $roomNo', 'floor': 1,
  'reading': {'temp': 27.4, 'hum': 58, 'co2': 1200},
  'levels': {'temp': 'normal', 'hum': 'normal', 'co2': 'exceeded'},
  'fanOn': false, 'ventMode': 'manual', 'updatedAt': 1700000000000,
  'lights': 8, 'lightsOn': 6, 'electricity': {'lightsKwh': 1.2, 'fanKwh': .3},
  'devices': [
    {'type': 'light', 'label': 'Lights', 'quantity': 8, 'activeQuantity': 6, 'wattsPerDevice': 18},
    {'type': 'exhaust_fan', 'label': 'Exhaust fan', 'quantity': 1, 'activeQuantity': 0, 'wattsPerDevice': 40, 'fanType': 'wall'},
  ],
};
Map<String, dynamic> sharedJson() => {
  'rooms': [roomJson(2, 104), roomJson(1, 101)],
  'thresholds': {'temp': {'warn': 30, 'limit': 32}, 'hum': {'warn': 65, 'limit': 75}, 'co2': {'warn': 1000, 'limit': 1200}},
  'fanTrigger': 'exceeded',
};
http.Response jsonResponse(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
http.Response fixtureResponse(http.Request request) {
  final path = request.url.path;
  if (path.endsWith('/auth/login')) return jsonResponse({'token': 'test-token', 'user': adminJson});
  if (path.endsWith('/auth/me')) return jsonResponse({'user': adminJson});
  if (path.endsWith('/simulation')) return jsonResponse(sharedJson());
  if (path.endsWith('/alerts')) return jsonResponse({'alerts': [{'id': 1, 'title': 'Demo: High CO₂ Level', 'body': 'CO₂ reached the configured limit.', 'room': 'Room 104', 'roomId': 2, 'type': 'exceeded', 'cats': ['exceeded', 'message'], 'ts': 1700000000000}]});
  if (path.endsWith('/settings')) return jsonResponse({'thresholds': sharedJson()['thresholds'], 'fanTrigger': 'exceeded', 'ventMode': 'manual'});
  if (path.endsWith('/admin/users')) return jsonResponse({'admins': [adminJson], 'viewers': []});
  if (path.endsWith('/sms-recipients')) return jsonResponse({'recipients': []});
  if (path.endsWith('/auth/change-password')) return jsonResponse({'token': 'new-test-token'});
  return jsonResponse({'ok': true});
}
AppModel testModel({MemoryStore? store, Future<http.Response> Function(http.Request)? handler}) => AppModel(
  api: ApiClient(baseUrl: 'https://test.invalid/api', client: MockClient(handler ?? (r) async => fixtureResponse(r))), store: store ?? MemoryStore());

void main() {
  test('API sends JSON and bearer tokens without changing the endpoint', () async {
    late http.Request captured;
    final api = ApiClient(baseUrl: 'https://test.invalid/api/', client: MockClient((request) async { captured = request; return jsonResponse({'ok': true}); }));
    api.token = 'private-test-token';
    await api.request('/simulation', method: 'POST', body: {'metric': 'co2', 'roomIds': [1, 2]});
    expect(captured.url.toString(), 'https://test.invalid/api/simulation');
    expect(captured.headers['Authorization'], 'Bearer private-test-token');
    expect(jsonDecode(captured.body), {'metric': 'co2', 'roomIds': [1, 2]}); api.close();
  });
  test('server errors remain readable', () async {
    final api = ApiClient(client: MockClient((_) async => jsonResponse({'error': 'Wrong admin access code.'}, 403)));
    await expectLater(api.request('/auth/register-admin', method: 'POST'), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Wrong admin access code.'))); api.close();
  });
  test('login chooses Room 101, restores typed readings and stores only the token', () async {
    final store = MemoryStore();
    final persisted = testModel(store: store); addTearDown(persisted.dispose);
    await persisted.initialize(); await persisted.login('admin', 'NotStored123', true);
    expect(persisted.user!.isAdmin, isTrue); expect(persisted.room!.name, 'Room 101');
    expect(persisted.room!.totalKwh, 1.5); expect(persisted.rooms.last.worst, 'exceeded');
    expect(store.values['safezone.flutter.token'], 'test-token'); expect(store.values.values, isNot(contains('NotStored123')));
    persisted.selectRoom(2); expect(persisted.room!.name, 'Room 104');
    await persisted.logout(); expect(persisted.rooms, isEmpty); expect(store.values.containsKey('safezone.flutter.token'), isFalse);
  });
  test('secure session restoration and password token rotation', () async {
    final store = MemoryStore(); store.values['safezone.flutter.token'] = 'restored-token';
    final model = testModel(store: store); addTearDown(model.dispose);
    await model.initialize(); expect(model.user!.username, 'admin');
    await model.changePassword('OldPassword123', 'NewPassword123'); expect(store.values['safezone.flutter.token'], 'new-test-token');
    await model.setTheme(ThemeMode.dark); expect(store.values['safezone.flutter.theme'], 'dark');
  });
  test('an in-flight poll cannot restore data after logout', () async {
    final pending = Completer<http.Response>(); bool delay = false;
    final model = testModel(handler: (r) async { if (delay && r.url.path.endsWith('/simulation')) return await pending.future; return fixtureResponse(r); }); addTearDown(model.dispose);
    await model.initialize(); await model.login('admin', 'Test12345', true); delay = true;
    final polling = model.poll(); await Future<void>.delayed(Duration.zero); await model.logout(); pending.complete(jsonResponse(sharedJson())); await polling;
    expect(model.user, isNull); expect(model.rooms, isEmpty); expect(model.alerts, isEmpty);
  });
  test('failed polls preserve readings and expose a stale-data message', () async {
    bool offline = false;
    final model = testModel(handler: (r) async { if (offline) throw http.ClientException('offline'); return fixtureResponse(r); }); addTearDown(model.dispose);
    await model.initialize(); await model.login('admin', 'Test12345', true); offline = true; await model.poll();
    expect(model.room!.reading['co2'], 1200); expect(model.syncError, contains('Cannot reach'));
  });
  test('password validation matches the current server rules', () {
    expect(() => validatePassword('abc123', 'abc123'), returnsNormally);
    expect(() => validatePassword('abc 123', 'abc 123'), throwsException);
    expect(() => validatePassword('abc', 'abc'), throwsException);
    expect(() => validatePassword('abc123', 'different'), throwsException);
  });
  test('threshold equality is danger and decimal API values are accepted', () {
    expect(const Limit(1000, 1200).level(1200), 'exceeded');
    expect(number('1.25'), 1.25); expect(readingText('co2', 1200), '1,200');
    expect(Room.fromJson(roomJson(1, 101)).fanCount, 1);
  });
}
