import 'dart:convert';
import 'package:flutter/material.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import 'widgets.dart';

Future<void> editRoom(BuildContext context, AppModel model, {Room? room}) => showModalBottomSheet<void>(
  context: context, isScrollControlled: true, useSafeArea: true,
  constraints: const BoxConstraints(maxWidth: 540),
  builder: (_) => RoomEditor(model: model, room: room),
);
class DeviceDraft {
  DeviceDraft(Device d) : type = d.type, fanType = d.fanType,
    label = TextEditingController(text: d.label), quantity = TextEditingController(text: '${d.quantity}'),
    active = TextEditingController(text: '${d.activeQuantity}'), watts = TextEditingController(text: '${d.watts}');
  DeviceDraft.fromDraft(Map<String, dynamic> d) : type = '${d['type']}', fanType = '${d['fanType']}',
    label = TextEditingController(text: '${d['label']}'), quantity = TextEditingController(text: '${d['quantity']}'),
    active = TextEditingController(text: '${d['active']}'), watts = TextEditingController(text: '${d['watts']}');
  Map<String, dynamic> draft() => {'type': type, 'fanType': fanType, 'label': label.text, 'quantity': quantity.text, 'active': active.text, 'watts': watts.text};
  String type, fanType;
  final TextEditingController label, quantity, active, watts;
  bool get powered => ['light', 'exhaust_fan'].contains(type);
  Map<String, dynamic> toJson() => {'type': type, 'label': label.text.trim(), 'quantity': int.tryParse(quantity.text),
    'activeQuantity': type == 'light' ? int.tryParse(active.text) : 0, 'wattsPerDevice': powered ? double.tryParse(watts.text) : 0, 'fanType': fanType};
  void dispose() { label.dispose(); quantity.dispose(); active.dispose(); watts.dispose(); }
}
class RoomEditor extends StatefulWidget {
  const RoomEditor({required this.model, this.room, super.key});
  final AppModel model;
  final Room? room;
  @override
  State<RoomEditor> createState() => _RoomEditorState();
}
class _RoomEditorState extends State<RoomEditor> {
  final form = GlobalKey<FormState>();
  final numberController = TextEditingController();
  final List<DeviceDraft> devices = [];
  late int floor;
  bool busy = false;
  String error = '';
  bool saved = false;
  late String initialDraft;
  String get draftKey => widget.room == null ? 'new' : '${widget.room!.id}';
  Map<String, dynamic> draft() => {'floor': floor, 'number': numberController.text, 'devices': devices.map((d) => d.draft()).toList()};
  int nextNumber(int f) {
    for (int n = f * 100 + 1; n < f * 100 + 100; n++) { if (!widget.model.rooms.any((r) => r.roomNo == n)) return n; }
    return f * 100 + 1;
  }
  @override
  void initState() {
    super.initState();
    final stored = widget.model.roomDrafts[draftKey];
    floor = stored == null ? widget.room?.floor ?? widget.model.room?.floor ?? 1 : number(stored['floor']).toInt();
    numberController.text = stored == null ? '${widget.room?.roomNo ?? nextNumber(floor)}' : '${stored['number']}';
    if (stored != null) {
      devices.addAll(array(stored['devices']).map((d) => DeviceDraft.fromDraft(object(d))));
    } else {
      devices.addAll((widget.room?.devices ?? [Device(type: 'light', label: 'Lights', quantity: 8, activeQuantity: 6, watts: 18), Device(type: 'exhaust_fan', label: 'Exhaust fan', watts: 40)]).map((d) => DeviceDraft(d.clone())));
    }
    initialDraft = jsonEncode(draft());
  }
  @override
  void dispose() {
    if (!saved && widget.model.user != null && jsonEncode(draft()) != initialDraft) widget.model.roomDrafts[draftKey] = draft();
    numberController.dispose(); for (final d in devices) { d.dispose(); } super.dispose();
  }
  Widget numeric(TextEditingController controller, String label, {bool decimal = false, int? min, int? max}) => TextFormField(
    controller: controller, keyboardType: TextInputType.numberWithOptions(decimal: decimal), decoration: InputDecoration(labelText: label),
    validator: (v) {
      final n = double.tryParse(v ?? '');
      if (n == null || !n.isFinite || (decimal && n <= 0) || (!decimal && n != n.roundToDouble()) || (min != null && n < min) || (max != null && n > max)) return 'Enter a valid value.';
      return null;
    },
  );
  Future<void> save() async {
    if (busy || !form.currentState!.validate()) return;
    setState(() { busy = true; error = ''; });
    try {
      for (final d in devices) { if (d.type == 'light' && int.parse(d.active.text) > int.parse(d.quantity.text)) throw Exception('Lights on cannot exceed the light quantity.'); }
      final result = await widget.model.call(widget.room == null ? '/rooms' : '/rooms/${widget.room!.id}', method: widget.room == null ? 'POST' : 'PATCH',
        body: {'floor': floor, 'roomNo': int.parse(numberController.text), 'devices': devices.map((d) => d.toJson()).toList()});
      saved = true; widget.model.roomDrafts.remove(draftKey);
      await widget.model.refresh();
      if (widget.room == null) widget.model.selectRoom(number(object(result['room'])['id']).toInt());
      if (mounted) { Navigator.pop(context); message(context, widget.room == null ? 'Room added' : 'Room updated'); }
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom), child: SizedBox(
    height: MediaQuery.sizeOf(context).height * .88,
    child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(18, 12, 18, 28), child: Form(key: form, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [Expanded(child: Text(widget.room == null ? 'Add a room' : 'Edit ${widget.room!.name}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))), IconButton(tooltip: 'Close', onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close))]),
      const SectionTitle('Floor'),
      Wrap(spacing: 8, children: List.generate(4, (i) => ChoiceChip(label: Text(floorName(i + 1)), selected: floor == i + 1,
        onSelected: busy ? null : (_) => setState(() { if (floor != i + 1) { floor = i + 1; numberController.text = '${nextNumber(floor)}'; } })))),
      const SizedBox(height: 16), numeric(numberController, 'Room number', min: floor * 100 + 1, max: floor * 100 + 99),
      const SizedBox(height: 8), Note('${floorName(floor)} rooms are ${floor * 100 + 1} to ${floor * 100 + 99}.'),
      const SectionTitle('Devices'), const Note('Use separate groups for different light wattages. Configure exhaust fans separately.'), const SizedBox(height: 14),
      for (int i = 0; i < devices.length; i++) Padding(padding: const EdgeInsets.only(bottom: 16), child: deviceCard(devices[i], i)),
      OutlinedButton.icon(onPressed: busy || devices.length >= 50 ? null : () => setState(() => devices.add(DeviceDraft(Device(type: 'light', label: 'Light', activeQuantity: 1, watts: 18)))), icon: const Icon(Icons.add), label: const Text('Add device')),
      const SizedBox(height: 12), if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      FilledButton(onPressed: busy ? null : save, child: Text(busy ? 'Saving…' : widget.room == null ? 'Add room' : 'Save room')),
    ]))),
  ));
  Widget deviceCard(DeviceDraft d, int index) => SzCard(key: ObjectKey(d), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text('Device ${index + 1}', style: const TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 14),
    DropdownButtonFormField<String>(initialValue: d.type, isExpanded: true, decoration: const InputDecoration(labelText: 'Device'),
      items: deviceNames.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))).toList(),
      onChanged: (v) { if (v != null) setState(() { d.type = v; d.label.text = deviceNames[v]!; if (v == 'exhaust_fan') d.watts.text = '40'; }); }),
    const SizedBox(height: 14), TextFormField(controller: d.label, maxLength: 100, decoration: const InputDecoration(labelText: 'Name', counterText: ''), validator: (v) => (v ?? '').trim().isEmpty ? 'Enter a device name.' : null),
    const SizedBox(height: 14), Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(child: numeric(d.quantity, 'Quantity', min: 1, max: 100)),
      if (d.powered) ...[const SizedBox(width: 10), Expanded(child: numeric(d.watts, 'Watts each', decimal: true, min: 0, max: 2000))],
    ]),
    if (d.type == 'light') ...[const SizedBox(height: 14), numeric(d.active, 'Lights on', min: 0, max: 100)],
    if (d.type == 'exhaust_fan') ...[const SizedBox(height: 14), DropdownButtonFormField<String>(initialValue: d.fanType, isExpanded: true,
      decoration: const InputDecoration(labelText: 'Exhaust fan type'), items: fanNames.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(), onChanged: (v) => setState(() => d.fanType = v ?? 'unspecified'))],
    const SizedBox(height: 6), Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: busy ? null : () => setState(() { devices.removeAt(index); d.dispose(); }), child: const Text('Remove device'))),
  ]));
}
