import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:safezone_flutter/main.dart';
import 'package:safezone_flutter/data/models.dart';
import 'package:safezone_flutter/ui/widgets.dart';
import 'package:safezone_flutter/ui/pages.dart';
import 'app_model_test.dart' as fixtures;

void main() {
  testWidgets('welcome screen offers the same two account roles', (tester) async {
    final model = fixtures.testModel(); await model.initialize();
    await tester.pumpWidget(SafeZoneApp(model: model)); await tester.pumpAndSettle();
    expect(find.text('SafeZone'), findsOneWidget);
    expect(find.text('Student / Faculty'), findsOneWidget); expect(find.text('Admin'), findsOneWidget);
    await tester.tap(find.text('Admin')); await tester.pumpAndSettle();
    expect(find.text('Admin Login'), findsOneWidget); expect(find.text('Forgot password?'), findsOneWidget);
    expect(find.text('Create an admin account'), findsNothing);
    expect(find.text('Create an account'), findsNothing);
    await tester.tap(find.text('Back')); await tester.pumpAndSettle();
    await tester.tap(find.text('Student / Faculty')); await tester.pumpAndSettle();
    expect(find.text('Create an account'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); model.dispose();
  });
  testWidgets('narrow room selector accommodates large text without wrapping its two lines', (tester) async {
    final room = Room.fromJson(fixtures.roomJson(1, 101));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(2)),
      child: SizedBox(width: 288, child: RoomSelector(rooms: [room], selected: room, onSelect: (_) {}, onAdd: () {})),
    ))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Room 101'), findsOneWidget);
  });
  testWidgets('cards provide a Material surface for settings tiles', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SzCard(child: ListTile(title: const Text('Manage Users'), onTap: () {})))));
    expect(tester.takeException(), isNull);
  });
  testWidgets('threshold fields retain their elements and drafts during live updates', (tester) async {
    final model = fixtures.testModel(); await model.initialize(); await model.login('admin', 'Test12345', true); model.pause();
    await tester.pumpWidget(SafeZoneApp(model: model)); await tester.pumpAndSettle();
    await tester.tap(find.text('Settings').last); await tester.pumpAndSettle();
    for (final metric in metrics) {
      final toggle = find.byKey(ValueKey('threshold-toggle-$metric'));
      await tester.ensureVisible(toggle); await tester.tap(toggle); await tester.pumpAndSettle();
      final warn = find.byKey(ValueKey('$metric-warn'));
      final limit = find.byKey(ValueKey('$metric-limit'));
      await tester.ensureVisible(warn); await tester.tap(warn); await tester.enterText(warn, '31');
      for (int tick = 0; tick < 4; tick++) { await model.poll(); await tester.pump(const Duration(milliseconds: 100)); }
      expect(tester.widget<TextField>(warn).controller!.text, '31');
      await tester.ensureVisible(limit); await tester.tap(limit); await tester.enterText(limit, '35');
      await model.poll(); await tester.pump(const Duration(milliseconds: 300));
      expect(tester.widget<TextField>(limit).controller!.text, '35');
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(toggle); await tester.tap(toggle); await tester.pumpAndSettle();
      await tester.tap(toggle); await tester.pumpAndSettle();
      expect(tester.widget<TextField>(warn).controller!.text, '31');
      expect(tester.widget<TextField>(limit).controller!.text, '35');
      await tester.tap(toggle); await tester.pumpAndSettle();
    }
    await tester.pumpWidget(const SizedBox()); model.dispose();
  });
  testWidgets('About sections expand and collapse like the original app', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: safeZoneTheme(Brightness.dark), home: const Scaffold(body: SingleChildScrollView(child: AboutPage()))));
    expect(find.textContaining('SafeZone compares room temperature'), findsNothing);
    await tester.tap(find.text('How it works')); await tester.pumpAndSettle();
    expect(find.textContaining('SafeZone compares room temperature'), findsOneWidget);
    await tester.tap(find.text('How it works')); await tester.pumpAndSettle();
    expect(find.textContaining('SafeZone compares room temperature'), findsNothing);
    await tester.tap(find.text('Current prototype')); await tester.pumpAndSettle();
    expect(find.textContaining('Sensor readings and fan operation are simulated.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  for (final width in [320.0, 390.0, 768.0]) {
    testWidgets('dashboard and room configuration fit width $width', (tester) async {
      tester.view.physicalSize = Size(width, 950); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final model = fixtures.testModel(); await model.initialize(); await model.login('admin', 'Test12345', true); model.pause();
      await tester.pumpWidget(SafeZoneApp(model: model)); await tester.pumpAndSettle();
      expect(find.text('Room 101'), findsOneWidget); expect(find.text('Exhaust fan'), findsOneWidget);
      expect(tester.takeException(), isNull);
      final cards = ['temp', 'hum', 'co2', 'fan'].map((name) => tester.getRect(find.byKey(ValueKey('sensor-$name')))).toList();
      for (final card in cards.skip(1)) {
        expect(card.height, closeTo(cards.first.height, .1));
        expect(card.width, closeTo(cards.first.width, .1));
      }
      expect(cards[0].top, closeTo(cards[1].top, .1));
      expect(cards[2].top, closeTo(cards[3].top, .1));
      await tester.tap(find.text('Settings').last); await tester.pumpAndSettle();
      expect(find.text('Edit room'), findsOneWidget); expect(find.text('Delete room'), findsOneWidget);
      expect(tester.getSize(find.text('Delete room')).height, closeTo(tester.getSize(find.text('Edit room')).height, .1));
      expect(find.text('Current rooms'), findsNothing); expect(find.text('Add Room'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Edit room')); await tester.pumpAndSettle();
      expect(find.text('Edit Room 101'), findsOneWidget); expect(find.text('Device 1'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox()); model.dispose();
    });
  }
}
