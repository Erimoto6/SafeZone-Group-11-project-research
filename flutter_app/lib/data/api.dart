import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'models.dart';

const defaultApiBase = 'https://safezone-group-11-project-research-production.up.railway.app/api';

class ApiException implements Exception {
  const ApiException(this.message, [this.status = 0]);
  final String message;
  final int status;
  @override
  String toString() => message;
}

abstract class SessionStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}
class SecureSessionStore implements SessionStore {
  const SecureSessionStore();
  static const _storage = FlutterSecureStorage();
  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class ApiClient {
  ApiClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        baseUrl = (baseUrl ?? const String.fromEnvironment('SAFEZONE_API_BASE', defaultValue: defaultApiBase)).replaceFirst(RegExp(r'/$'), '');
  final http.Client _client;
  final String baseUrl;
  String token = '';
  Future<Map<String, dynamic>> request(String path, {String method = 'GET', Map<String, dynamic>? body}) async {
    try {
      final request = http.Request(method, Uri.parse('$baseUrl$path'));
      request.headers.addAll({'Content-Type': 'application/json', if (token.isNotEmpty) 'Authorization': 'Bearer $token'});
      if (body != null) request.body = jsonEncode(body);
      final response = await http.Response.fromStream(await _client.send(request).timeout(const Duration(seconds: 15)))
          .timeout(const Duration(seconds: 15));
      Map<String, dynamic> result;
      try { result = object(jsonDecode(response.body)); }
      on FormatException { throw const ApiException('The server returned an unexpected response. Please try again.'); }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException('${result['error'] ?? 'The request failed. Please try again.'}', response.statusCode);
      }
      return result;
    } on ApiException { rethrow; }
    on TimeoutException { throw const ApiException('The server took too long to respond. Check your connection and try again.'); }
    catch (_) { throw const ApiException('Cannot reach the SafeZone server. Check your internet connection and try again.'); }
  }
  void close() => _client.close();
}
