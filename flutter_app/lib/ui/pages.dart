import 'package:flutter/material.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import 'widgets.dart';
import 'chart.dart';
import 'room_editor.dart';

class HomePage extends StatelessWidget {
  const HomePage({required this.model, required this.onMonitor, super.key});
  final AppModel model;
  final VoidCallback onMonitor;
  @override
  Widget build(BuildContext context) {
    final room = model.room;
    if (room == null) return const Note('No rooms are available. Ask an administrator to configure a room.');
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(model.isAdmin ? 'Welcome, ${model.user!.fullName.isEmpty ? 'Admin' : model.user!.fullName.split(' ').first}!' : 'Classroom Environment', style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
      const SizedBox(height: 6), Note('Real-time indoor conditions in ${room.name}.'), const SizedBox(height: 18),
      RoomSelector(rooms: model.rooms, selected: room, onSelect: model.selectRoom, onAdd: model.isAdmin ? () => editRoom(context, model) : null),
      const SizedBox(height: 12), Row(children: [Icon(Icons.circle, size: 9, color: model.syncError.isEmpty ? statusColor('normal', context) : statusColor('warning', context)), const SizedBox(width: 6), Flexible(child: Note('Live, updated ${timeText(room.updatedAt)}'))]),
      const SizedBox(height: 16), LayoutBuilder(builder: (_, constraints) {
        final cards = [for (final metric in metrics) sensor(context, room, metric), fanCard(room)];
        if (constraints.maxWidth < 265) {
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (int i = 0; i < cards.length; i++) Padding(padding: EdgeInsets.only(bottom: i == cards.length - 1 ? 0 : 12), child: cards[i]),
          ]);
        }
        // Both columns divide the height of the tallest card into equal cells.
        // Intrinsic sizing accommodates font scaling and the extra admin fan link.
        return IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: cards[0]), const SizedBox(height: 12), Expanded(child: cards[2])])),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: cards[1]), const SizedBox(height: 12), Expanded(child: cards[3])])),
        ]));
      }),
      const SizedBox(height: 16), InkWell(onTap: onMonitor, borderRadius: BorderRadius.circular(18), child: SzCard(child: Row(children: [
        Icon(Icons.bolt, color: Theme.of(context).colorScheme.primary), const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(energyText(room.totalKwh), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)), const Note('Electricity · accumulated estimate')])), const Icon(Icons.chevron_right),
      ]))),
      const SizedBox(height: 16), SzCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(room.worst == 'normal' ? Icons.eco_outlined : Icons.warning_amber, color: statusColor(room.worst, context)), const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(room.worst == 'normal' ? 'Environment Healthy' : room.worst == 'warning' ? 'Environment Warning' : 'Danger Level Reached', style: TextStyle(fontWeight: FontWeight.w700, color: statusColor(room.worst, context))),
          const SizedBox(height: 4), Text(room.worst == 'normal' ? 'Readings are within the configured limits.' : 'Check Monitoring and Alerts for this room.', style: const TextStyle(fontSize: 12))])),
      ])),
      const SectionTitle('Status guide'), SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final status in ['normal', 'warning', 'exceeded']) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [Icon(Icons.circle, size: 10, color: statusColor(status, context)), const SizedBox(width: 10), Expanded(child: Text('${levelName(status)}: ${status == 'normal' ? 'within limits' : status == 'warning' ? 'near the limit' : 'limit reached or exceeded'}', style: const TextStyle(fontSize: 13)))])),
      ])),
    ]);
  }
  Widget sensor(BuildContext context, Room room, String metric) => SzCard(key: ValueKey('sensor-$metric'), child: ConstrainedBox(constraints: const BoxConstraints(minHeight: 118), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(children: [Icon(metricIcons[metric], size: 23, color: metric == 'temp' ? const Color(0xFFE77A74) : metric == 'hum' ? const Color(0xFF6BA4D8) : null), const SizedBox(width: 7), Flexible(child: Text(metricNames[metric]!, style: const TextStyle(fontSize: 13)))]),
    const SizedBox(height: 10), FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text.rich(TextSpan(children: [
      TextSpan(text: readingText(metric, room.reading[metric] ?? 0), style: const TextStyle(fontSize: 29, fontWeight: FontWeight.w800)),
      TextSpan(text: ' ${metricUnits[metric]}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
    ]))), const SizedBox(height: 9), StatusPill(room.levels[metric] ?? 'normal'),
  ])));
  Widget fanCard(Room room) => SzCard(key: const ValueKey('sensor-fan'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    const Row(children: [Icon(Icons.air, size: 23), SizedBox(width: 8), Flexible(child: Text('Exhaust fan', style: TextStyle(fontSize: 13)))]),
    const SizedBox(height: 10), Text(room.fanOn ? 'ON' : 'OFF', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 30)),
    const SizedBox(height: 6), Note('${room.fanCount} exhaust fan(s)'), Note(room.mode == 'auto' ? 'Automatic' : 'Manual'),
    if (model.isAdmin) TextButton(onPressed: onMonitor, style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 36)), child: const Text('Control in Monitoring', style: TextStyle(fontSize: 11))),
  ]));

}

class AlertsPage extends StatefulWidget {
  const AlertsPage({required this.model, super.key});
  final AppModel model;
  @override
  State<AlertsPage> createState() => _AlertsPageState();
}
class _AlertsPageState extends State<AlertsPage> {
  String filter = 'all';
  @override
  Widget build(BuildContext context) {
    final alerts = widget.model.alerts.where((a) => a.matches(filter)).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(spacing: 8, children: {'all': 'All', 'exceeded': 'Danger', 'message': 'Messages', 'system': 'System'}.entries.map((e) => ChoiceChip(label: Text(e.value), selected: filter == e.key, onSelected: (_) => setState(() => filter = e.key))).toList()),
      const SizedBox(height: 16), if (alerts.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No alerts yet.', textAlign: TextAlign.center)),
      for (final a in alerts) Padding(padding: const EdgeInsets.only(bottom: 12), child: SzCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(a.type == 'ventilation' ? Icons.air : a.type == 'normal' ? Icons.check_circle_outline : Icons.warning_amber, color: statusColor(a.type, context)), const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(a.title, style: const TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 5), Text(a.body, style: const TextStyle(fontSize: 13, height: 1.4)), const SizedBox(height: 8), Note('${a.room} · ${a.time.month}/${a.time.day} · ${timeText(a.time)}')])),
      ]))),
    ]);
  }
}

class MonitorPage extends StatefulWidget {
  const MonitorPage({required this.model, super.key});
  final AppModel model;
  @override
  State<MonitorPage> createState() => _MonitorPageState();
}
class _MonitorPageState extends State<MonitorPage> {
  String metric = 'temp';
  bool history = false, busy = false;
  Future<void> run(Future<void> Function() action) async {
    if (busy) return; setState(() => busy = true);
    try { await action(); } catch (e) { if (mounted) message(context, '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final model = widget.model, room = widget.model.room;
    if (room == null) return const Note('No room selected.');
    final samples = model.samples[room.id] ?? [];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SegmentedButton<bool>(segments: const [ButtonSegment(value: false, label: Text('Real-time')), ButtonSegment(value: true, label: Text('History'))], selected: {history}, onSelectionChanged: (v) => setState(() => history = v.first)), const SizedBox(height: 16),
      RoomSelector(rooms: model.rooms, selected: room, onSelect: model.selectRoom, onAdd: model.isAdmin ? () => editRoom(context, model) : null),
      const SectionTitle('Exhaust fan control'), SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [const Icon(Icons.air), const SizedBox(width: 10), Expanded(child: Text('Exhaust fan ${room.fanOn ? 'ON' : 'OFF'}', style: const TextStyle(fontWeight: FontWeight.w700))), Text(room.mode == 'auto' ? 'Automatic' : 'Manual', style: const TextStyle(fontSize: 12))]),
        if (model.isAdmin) ...[
          const SizedBox(height: 12), Wrap(spacing: 10, runSpacing: 8, children: [
            OutlinedButton(onPressed: busy ? null : () => run(() => model.mutate('/simulation', body: {'metric': 'fan', 'roomIds': [room.id], 'fanOn': !room.fanOn})), child: Text(room.fanOn ? 'Turn OFF' : 'Turn ON')),
            OutlinedButton(onPressed: busy || room.mode == 'auto' ? null : () => run(() => model.mutate('/rooms/${room.id}', method: 'PATCH', body: {'ventMode': 'auto'})), child: const Text('Automatic mode')),
          ]), const SizedBox(height: 8), Note(room.mode == 'manual' ? 'Manual mode does not turn the fan on at a threshold. Choose Automatic mode for threshold control.' : 'Automatic fan starts at ${model.fanTrigger == 'warning' ? 'Warning' : 'Danger'}.'),
        ],
      ])),
      const SectionTitle('Electricity'), SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(energyText(room.totalKwh), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), const Note('Accumulated estimate from configured ratings and simulated operating time.'), const SizedBox(height: 16),
        Row(children: [const Icon(Icons.lightbulb_outline), const SizedBox(width: 10), Expanded(child: Text('Lights · ${room.lightsOn} of ${room.lights} on')), Text(energyText(room.lightsKwh), style: const TextStyle(fontWeight: FontWeight.w600))]), const SizedBox(height: 14),
        Row(children: [const Icon(Icons.air), const SizedBox(width: 10), const Expanded(child: Text('Exhaust fans')), Text(energyText(room.fanKwh), style: const TextStyle(fontWeight: FontWeight.w600))]),
      ])),
      const SectionTitle('Room readings'), Wrap(spacing: 8, runSpacing: 6, children: metrics.map((k) => ChoiceChip(label: Text(metricNames[k]!), selected: metric == k, onSelected: (_) => setState(() => metric = k))).toList()), const SizedBox(height: 14),
      SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 8, children: [Text('${metricNames[metric]}: ${readingText(metric, room.reading[metric] ?? 0)} ${metricUnits[metric]}', style: const TextStyle(fontWeight: FontWeight.w700)), StatusPill(room.levels[metric] ?? 'normal')]),
        ReadingChart(samples: history ? samples : samples.skip(samples.length > 40 ? samples.length - 40 : 0).toList(), metric: metric, limit: model.limits[metric] ?? const Limit(0, 1)),
        Note('Warning ${model.limits[metric]?.warn} ${metricUnits[metric]} · Limit ${model.limits[metric]?.limit} ${metricUnits[metric]}'),
      ])),
      if (history) const Padding(padding: EdgeInsets.only(top: 12), child: Note('History contains readings collected while this Flutter app is open. Earlier server history is not available through the current API.')),
    ]);
  }
}
class DevicesPage extends StatelessWidget {
  const DevicesPage({required this.model, super.key});
  final AppModel model;
  @override
  Widget build(BuildContext context) {
    final room = model.room;
    if (room == null) return const Note('No room selected.');
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('Room devices', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)), const SizedBox(height: 6), Note('Configured devices for ${room.name}.'), const SizedBox(height: 16),
      RoomSelector(rooms: model.rooms, selected: room, onSelect: model.selectRoom), const SizedBox(height: 16),
      if (room.devices.isEmpty) const Note('No devices configured.'),
      for (final d in room.devices) Padding(padding: const EdgeInsets.only(bottom: 10), child: SzCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(d.type == 'light' ? Icons.lightbulb_outline : d.type == 'exhaust_fan' ? Icons.air : Icons.memory), const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(d.label, style: const TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 4), Note('${d.quantity} × ${deviceNames[d.type] ?? d.type}${d.watts > 0 ? ' · ${d.watts} W each' : ''}${d.type == 'exhaust_fan' ? '\n${fanNames[d.fanType] ?? 'Not specified'}' : ''}') ])),
        const SizedBox(width: 6), Text(d.type == 'exhaust_fan' ? room.fanOn ? 'Running' : 'Off' : d.type == 'light' ? '${d.activeQuantity} on' : 'Configured', style: TextStyle(color: Theme.of(context).colorScheme.primary, fontSize: 12)),
      ]))),
    ]);
  }
}
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});
  @override
  Widget build(BuildContext context) => const Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Center(child: Logo()), SizedBox(height: 16), Text('SafeZone', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800)), SizedBox(height: 10),
    Text('A safer classroom. A healthier environment.', textAlign: TextAlign.center), SizedBox(height: 22),
    SzCard(padding: EdgeInsets.symmetric(horizontal: 14), child: ExpansionTile(
      key: PageStorageKey('about-how'), leading: Icon(Icons.info_outline), title: Text('How it works', style: TextStyle(fontWeight: FontWeight.w700)), tilePadding: EdgeInsets.zero,
      children: [Padding(padding: EdgeInsets.only(bottom: 16), child: Text('SafeZone compares room temperature, humidity and CO₂ with configured warning and danger thresholds. Admins configure rooms, start shared simulations and choose automatic or manual exhaust fan operation. Students and faculty view readings and alerts from the same backend.', style: TextStyle(height: 1.6)))],
    )), SizedBox(height: 12),
    SzCard(padding: EdgeInsets.symmetric(horizontal: 14), child: ExpansionTile(
      key: PageStorageKey('about-prototype'), leading: Icon(Icons.memory), title: Text('Current prototype', style: TextStyle(fontWeight: FontWeight.w700)), tilePadding: EdgeInsets.zero,
      children: [Padding(padding: EdgeInsets.only(bottom: 16), child: Text('Sensor readings and fan operation are simulated. Device lists are configured inventory. Electricity is estimated in kWh. No physical fan commands or SMS messages are sent. Accounts and shared state are saved in MySQL through the Node.js/Express API.', style: TextStyle(height: 1.6)))],
    )),
  ]);
}
