import 'package:flutter/material.dart';

double number(dynamic value, [double fallback = 0]) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? fallback;
Map<String, dynamic> object(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<dynamic> array(dynamic value) => value is List ? value : <dynamic>[];

const metrics = ['temp', 'hum', 'co2'];
const metricNames = {'temp': 'Temperature', 'hum': 'Humidity', 'co2': 'CO₂'};
const metricUnits = {'temp': '°C', 'hum': '%', 'co2': 'ppm'};
const metricIcons = {
  'temp': Icons.thermostat_outlined,
  'hum': Icons.water_drop_outlined,
  'co2': Icons.cloud_outlined,
};
const deviceNames = {
  'light': 'Light', 'exhaust_fan': 'Exhaust fan', 'esp32': 'ESP32',
  'temp_sensor': 'Temperature sensor', 'hum_sensor': 'Humidity sensor',
  'co2_sensor': 'CO₂ sensor', 'wifi': 'Wi-Fi', 'sms_module': 'SMS module',
  'power_meter': 'Power meter',
};
const fanNames = {
  'unspecified': 'Not specified', 'wall': 'Wall-mounted',
  'window': 'Window-mounted', 'ceiling': 'Ceiling-mounted', 'inline': 'Inline',
};
const recipientRoles = ['Admin', 'Faculty', 'Student', 'Maintenance', 'Other'];
String recipientRole(dynamic value) => value == 'Student / Faculty' ? 'Student' : recipientRoles.contains(value) ? '$value' : 'Other';
String readingText(String metric, double value) {
  if (metric == 'temp') return value.toStringAsFixed(1);
  final text = value.round().toString();
  return text.replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},');
}
String energyText(double value) => '${value.toStringAsFixed(4)} kWh';
String floorName(int floor) => '${floor == 1 ? '1st' : floor == 2 ? '2nd' : floor == 3 ? '3rd' : '${floor}th'} Floor';
String timeText(DateTime time) => '${time.hour % 12 == 0 ? 12 : time.hour % 12}:${time.minute.toString().padLeft(2, '0')}:${time.second.toString().padLeft(2, '0')} ${time.hour < 12 ? 'AM' : 'PM'}';

class Limit {
  const Limit(this.warn, this.limit);
  final double warn;
  final double limit;
  factory Limit.fromJson(dynamic json) {
    final data = object(json);
    return Limit(number(data['warn']), number(data['limit']));
  }
  Map<String, dynamic> toJson() => {'warn': warn, 'limit': limit};
  String level(double value) => value >= limit ? 'exceeded' : value >= warn ? 'warning' : 'normal';
}

class Account {
  Account.fromJson(Map<String, dynamic> json)
      : id = number(json['id']).toInt(), role = '${json['role'] ?? 'viewer'}',
        kind = '${json['kind'] ?? ''}', username = '${json['username'] ?? ''}',
        email = '${json['email'] ?? ''}', phone = '${json['phone'] ?? ''}',
        fullName = '${json['fullName'] ?? ''}';
  final int id;
  final String role, kind, username, email, phone, fullName;
  bool get isAdmin => role == 'admin';
  String get name => fullName.isNotEmpty ? fullName : username.isNotEmpty ? username : email;
}

class Device {
  Device({required this.type, required this.label, this.quantity = 1,
    this.activeQuantity = 0, this.watts = 0, this.fanType = 'unspecified'});
  String type, label, fanType;
  int quantity, activeQuantity;
  double watts;
  factory Device.fromJson(dynamic value) {
    final d = object(value);
    return Device(type: '${d['type']}', label: '${d['label']}',
      quantity: number(d['quantity'], 1).toInt(), activeQuantity: number(d['activeQuantity']).toInt(),
      watts: number(d['wattsPerDevice']), fanType: '${d['fanType'] ?? 'unspecified'}');
  }
  Map<String, dynamic> toJson() => {'type': type, 'label': label, 'quantity': quantity,
    'activeQuantity': activeQuantity, 'wattsPerDevice': watts, 'fanType': fanType};
  Device clone() => Device.fromJson(toJson());
}

class Room {
  Room.fromJson(Map<String, dynamic> json)
      : id = number(json['id']).toInt(), name = '${json['name']}',
        floor = number(json['floor'], 1).toInt(),
        reading = object(json['reading']).map((k, v) => MapEntry(k, number(v))),
        levels = object(json['levels']).map((k, v) => MapEntry(k, '$v')),
        fanOn = json['fanOn'] == true, mode = '${json['ventMode'] ?? 'auto'}',
        devices = array(json['devices']).map(Device.fromJson).toList(),
        lights = number(json['lights']).toInt(), lightsOn = number(json['lightsOn']).toInt(),
        lightsKwh = number(object(json['electricity'])['lightsKwh']),
        fanKwh = number(object(json['electricity'])['fanKwh']),
        updatedAt = DateTime.fromMillisecondsSinceEpoch(number(json['updatedAt'], DateTime.now().millisecondsSinceEpoch.toDouble()).toInt());
  final int id, floor, lights, lightsOn;
  final String name, mode;
  final bool fanOn;
  final List<Device> devices;
  final Map<String, double> reading;
  final Map<String, String> levels;
  final double lightsKwh, fanKwh;
  final DateTime updatedAt;
  int get roomNo => int.tryParse(name.replaceAll(RegExp(r'[^0-9]'), '')) ?? 101;
  int get fanCount => devices.where((d) => d.type == 'exhaust_fan').fold(0, (n, d) => n + d.quantity);
  String get worst => levels.containsValue('exceeded') ? 'exceeded' : levels.containsValue('warning') ? 'warning' : 'normal';
  double get totalKwh => lightsKwh + fanKwh;
}

class AlertItem {
  AlertItem.fromJson(dynamic json) : data = object(json);
  final Map<String, dynamic> data;
  int get id => number(data['id']).toInt();
  String get title => '${data['title'] ?? ''}';
  String get body => '${data['body'] ?? ''}';
  String get type => '${data['type'] ?? 'normal'}';
  String get room => '${data['room'] ?? 'Removed room'}';
  DateTime get time => DateTime.fromMillisecondsSinceEpoch(number(data['ts']).toInt());
  bool matches(String filter) => filter == 'all' || array(data['cats']).contains(filter);
}
