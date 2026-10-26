import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../data/app_model.dart';
import '../data/models.dart';

class ReadingChart extends StatelessWidget {
  const ReadingChart({required this.samples, required this.metric, required this.limit, super.key});
  final List<Sample> samples;
  final String metric;
  final Limit limit;
  @override
  Widget build(BuildContext context) => Semantics(
    label: '${metricNames[metric]} chart, ${samples.length} readings. Warning ${limit.warn}, danger ${limit.limit}.',
    child: SizedBox(height: 235, width: double.infinity, child: CustomPaint(painter: _ChartPainter(samples, metric, limit, Theme.of(context)))),
  );
}
class _ChartPainter extends CustomPainter {
  _ChartPainter(this.samples, this.metric, this.limit, this.theme);
  final List<Sample> samples;
  final String metric;
  final Limit limit;
  final ThemeData theme;
  void label(Canvas canvas, String text, Offset offset) {
    final p = TextPainter(text: TextSpan(text: text, style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 10)), textDirection: TextDirection.ltr)..layout(); p.paint(canvas, offset);
  }
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTRB(42, 16, size.width - 12, size.height - 30);
    if (rect.width <= 0 || rect.height <= 0) return;
    final values = samples.map((s) => s.reading[metric] ?? 0).toList();
    final low = math.min(values.isEmpty ? 0.0 : values.reduce(math.min), math.min(limit.warn, limit.limit));
    final high = math.max(values.isEmpty ? limit.limit : values.reduce(math.max), limit.limit);
    final padding = math.max((high - low) * .2, metric == 'temp' ? 2.0 : metric == 'co2' ? 100.0 : 5.0);
    final min = low - padding, max = high + padding;
    double y(double n) => rect.bottom - (n - min) / (max - min) * rect.height;
    for (int i = 0; i <= 4; i++) {
      final value = min + (max - min) * i / 4, point = y(value);
      canvas.drawLine(Offset(rect.left, point), Offset(rect.right, point), Paint()..color = theme.dividerColor);
      label(canvas, metric == 'temp' ? value.toStringAsFixed(1) : '${value.round()}', Offset(0, point - 6));
    }
    for (final entry in [(limit.warn, const Color(0xFFC89A00)), (limit.limit, const Color(0xFFD34B4B))]) {
      final paint = Paint()..color = entry.$2..strokeWidth = 1.2;
      for (double x = rect.left; x < rect.right; x += 9) { canvas.drawLine(Offset(x, y(entry.$1)), Offset(math.min(x + 5, rect.right), y(entry.$1)), paint); }
    }
    if (values.isNotEmpty) {
      final path = Path();
      for (int i = 0; i < values.length; i++) {
        final x = values.length == 1 ? rect.center.dx : rect.left + i / (values.length - 1) * rect.width;
        if (i == 0) { path.moveTo(x, y(values[i])); } else { path.lineTo(x, y(values[i])); }
      }
      canvas.drawPath(path, Paint()..color = theme.colorScheme.primary..strokeWidth = 2.5..style = PaintingStyle.stroke);
      if (values.length == 1) canvas.drawCircle(Offset(rect.center.dx, y(values.first)), 3, Paint()..color = theme.colorScheme.primary);
      label(canvas, timeText(samples.first.time), Offset(rect.left, rect.bottom + 10));
      if (size.width > 230 && samples.length > 1) label(canvas, timeText(samples.last.time), Offset(rect.right - 70, rect.bottom + 10));
    }
  }
  @override
  bool shouldRepaint(covariant _ChartPainter oldDelegate) => true;
}
