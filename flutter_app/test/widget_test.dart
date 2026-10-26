import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:safezone_flutter/main.dart';
import 'app_model_test.dart' as fixtures;

void main() {
  testWidgets('welcome screen offers the same two account roles', (tester) async {
    final model = fixtures.testModel(); await model.initialize();
    await tester.pumpWidget(SafeZoneApp(model: model)); await tester.pumpAndSettle();
    expect(find.text('SafeZone'), findsOneWidget);
    expect(find.text('Student / Faculty'), findsOneWidget); expect(find.text('Admin'), findsOneWidget);
    await tester.tap(find.text('Admin')); await tester.pumpAndSettle();
    expect(find.text('Admin Login'), findsOneWidget); expect(find.text('Forgot password?'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); model.dispose();
  });
  for (final width in [320.0, 390.0, 768.0]) {
    testWidgets('dashboard and room configuration fit width $width', (tester) async {
      tester.view.physicalSize = Size(width, 950); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final model = fixtures.testModel(); await model.initialize(); await model.login('admin', 'Test12345', true); model.pause();
      await tester.pumpWidget(SafeZoneApp(model: model)); await tester.pumpAndSettle();
      expect(find.text('Room 101'), findsOneWidget); expect(find.text('Exhaust fan'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Settings').last); await tester.pumpAndSettle();
      expect(find.text('Edit room'), findsOneWidget); expect(find.text('Delete room'), findsOneWidget);
      expect(find.text('Current rooms'), findsNothing); expect(find.text('Add Room'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Edit room')); await tester.pumpAndSettle();
      expect(find.text('Edit Room 101'), findsOneWidget); expect(find.text('Device 1'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox()); model.dispose();
    });
  }
}
