import 'package:flutter/material.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import 'widgets.dart';
import 'room_editor.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({required this.model, required this.onUsers, required this.onAccount, required this.onRecipients, super.key});
  final AppModel model;
  final VoidCallback onUsers, onAccount, onRecipients;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}
class _SettingsPageState extends State<SettingsPage> {
  final Map<String, TextEditingController> values = {};
  late String trigger;
  late bool automatic;
  int? configId;
  String scope = '';
  final Set<int> selected = {};
  bool busy = false;
  final Set<String> expandedThresholds = {};
  @override
  void initState() { super.initState(); loadValues(); }
  void loadValues() {
    for (final metric in metrics) {
      values.putIfAbsent('$metric-warn', () => TextEditingController()).text = '${widget.model.limits[metric]?.warn ?? 0}';
      values.putIfAbsent('$metric-limit', () => TextEditingController()).text = '${widget.model.limits[metric]?.limit ?? 1}';
    }
    trigger = widget.model.fanTrigger;
    automatic = widget.model.rooms.every((r) => r.mode == 'auto');
  }
  @override
  void dispose() { for (final c in values.values) { c.dispose(); } super.dispose(); }
  Future<void> run(Future<void> Function() action) async {
    if (busy) return; setState(() => busy = true);
    try { await action(); } catch (e) { if (mounted) message(context, '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> save() => run(() async {
    final thresholds = <String, dynamic>{};
    for (final k in metrics) {
      final warn = double.tryParse(values['$k-warn']!.text), limit = double.tryParse(values['$k-limit']!.text);
      if (warn == null || limit == null || !warn.isFinite || !limit.isFinite || warn >= limit) throw Exception('${metricNames[k]}: warning must be lower than the limit.');
      thresholds[k] = {'warn': warn, 'limit': limit};
    }
    await widget.model.mutate('/settings', method: 'PUT', body: {'thresholds': thresholds, 'fanTrigger': trigger, 'ventMode': automatic ? 'auto' : 'manual'});
    if (mounted) message(context, 'Changes saved to the server');
  });
  Future<void> deleteRoom(Room room) async {
    final confirmed = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: Text('Remove ${room.name}?'), content: const Text('This removes the room, its devices and accumulated electricity estimate. Alert history remains without its room link.'),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete room'))],
    ));
    if (confirmed != true) return;
    await run(() async { await widget.model.mutate('/rooms/${room.id}', method: 'DELETE', body: {}); widget.model.roomDrafts.remove('${room.id}'); if (mounted) message(context, 'Room removed'); });
  }
  Future<void> simulate(String metric) => run(() async {
    final m = widget.model;
    selected.removeWhere((id) => !m.rooms.any((r) => r.id == id));
    final ids = scope == 'multiple' ? selected.toList() : [int.tryParse(scope) ?? m.room!.id];
    if (scope == 'multiple' && ids.isEmpty) throw Exception('Select at least one room.');
    await m.mutate('/simulation', body: {'metric': metric, if (scope == 'all') 'allRooms': true else 'roomIds': ids});
    if (mounted) message(context, metric == 'reset' ? 'Shared readings reset. Energy totals and alert history were kept.' : 'Shared simulation started. Readings will rise gradually.');
  });
  Widget link(IconData icon, String title, String subtitle, VoidCallback onTap) => ListTile(
    contentPadding: EdgeInsets.zero, leading: Icon(icon, color: Theme.of(context).colorScheme.primary), title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)), subtitle: Text(subtitle, style: const TextStyle(fontSize: 12)), trailing: const Icon(Icons.chevron_right), onTap: onTap,
  );
  Widget roomAction(IconData icon, String label, VoidCallback action, {bool destructive = false}) => OutlinedButton(
    onPressed: busy ? null : action,
    style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12), foregroundColor: destructive ? Theme.of(context).colorScheme.error : null),
    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, size: 16), const SizedBox(width: 6), Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1, softWrap: false)))]),
  );
  Widget thresholdEditor(String metric) {
    final open = expandedThresholds.contains(metric);
    return Column(key: ValueKey('threshold-$metric'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Semantics(button: true, expanded: open, child: InkWell(key: ValueKey('threshold-toggle-$metric'), onTap: () {
        FocusScope.of(context).unfocus();
        setState(() => open ? expandedThresholds.remove(metric) : expandedThresholds.add(metric));
      }, child: Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Row(children: [
        Icon(metricIcons[metric]), const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${metricNames[metric]} Threshold', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)), const SizedBox(height: 4), const Note('Set the warning and limit')])),
        Icon(open ? Icons.expand_less : Icons.expand_more),
      ])))),
      // Keep editable elements mounted across collapse and live polling updates.
      Visibility(visible: open, maintainState: true, child: Padding(padding: const EdgeInsets.only(top: 4, bottom: 16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: TextField(key: ValueKey('$metric-warn'), controller: values['$metric-warn'], keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: 'Warning (${metricUnits[metric]})'))), const SizedBox(width: 10),
        Expanded(child: TextField(key: ValueKey('$metric-limit'), controller: values['$metric-limit'], keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: 'Limit (${metricUnits[metric]})'))),
      ]))),
    ]);
  }
  @override
  Widget build(BuildContext context) {
    final m = widget.model;
    if (m.rooms.isEmpty) return const Note('No rooms available.');
    final room = m.rooms.firstWhere((r) => r.id == configId, orElse: () => m.rooms.first);
    final scopeValue = scope == 'multiple' || scope == 'all' || m.rooms.any((r) => '${r.id}' == scope) ? scope : '${m.room!.id}';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionTitle('Admin account'), SzCard(child: Column(children: [
        link(Icons.people_outline, 'Manage Users', 'Admins and registered accounts', widget.onUsers), const Divider(height: 1),
        link(Icons.person_outline, 'Account Settings', 'Username and password', widget.onAccount),
      ])),
      const SizedBox(height: 16), SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Room', style: TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 12),
        InputDecorator(decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 3)), child: DropdownButtonHideUnderline(child: DropdownButton<int>(
          isExpanded: true, value: room.id, items: m.rooms.map((r) => DropdownMenuItem(value: r.id, child: Text(r.name))).toList(), onChanged: (v) => setState(() => configId = v),
        ))), const SizedBox(height: 10), Row(children: [
          Expanded(child: roomAction(Icons.edit_outlined, 'Edit room', () => editRoom(context, m, room: room))), const SizedBox(width: 10),
          Expanded(child: roomAction(Icons.delete_outline, 'Delete room', () => deleteRoom(room), destructive: true)),
        ]),
      ])),
      const SectionTitle('Alerts'), SzCard(child: link(Icons.sms_outlined, 'SMS Alerts', 'SMS contacts, roles and mobile numbers', widget.onRecipients)),
      const SectionTitle('System settings'), SzCard(child: Column(children: [
        for (final k in metrics) thresholdEditor(k),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Automatic ventilation', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)), subtitle: const Text('Automatic or manual, for all rooms', style: TextStyle(fontSize: 12)), value: automatic, onChanged: (v) => setState(() => automatic = v)),
        const Align(alignment: Alignment.centerLeft, child: Text('Turn fan on at', style: TextStyle(fontWeight: FontWeight.w700))), const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 6, children: [ChoiceChip(label: const Text('Yellow (Warning)'), selected: trigger == 'warning', onSelected: (_) => setState(() => trigger = 'warning')), ChoiceChip(label: const Text('Red (Danger)'), selected: trigger == 'exceeded', onSelected: (_) => setState(() => trigger = 'exceeded'))]),
      ])), const SizedBox(height: 14), FilledButton(onPressed: busy ? null : save, child: Text(busy ? 'Please wait…' : 'Save changes')),
      const SectionTitle('Shared demo tools'), const Note('Everyone connected to this server sees the affected rooms change. Hardware and SMS are not connected.'), const SizedBox(height: 14),
      InputDecorator(decoration: const InputDecoration(labelText: 'Rooms to affect', contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 3)), child: DropdownButtonHideUnderline(child: DropdownButton<String>(isExpanded: true, value: scopeValue,
        items: [...m.rooms.map((r) => DropdownMenuItem(value: '${r.id}', child: Text(r.name))), const DropdownMenuItem(value: 'multiple', child: Text('Select multiple rooms')), const DropdownMenuItem(value: 'all', child: Text('All rooms'))],
        onChanged: busy ? null : (v) => setState(() => scope = v ?? ''),
      ))),
      if (scope == 'multiple') Padding(padding: const EdgeInsets.only(top: 10), child: SzCard(padding: const EdgeInsets.symmetric(horizontal: 12), child: ExpansionTile(title: Text('Select rooms (${selected.length} selected)', style: const TextStyle(fontSize: 14)), tilePadding: EdgeInsets.zero, children: [
        SizedBox(height: 220, child: ListView(children: m.rooms.map((r) => CheckboxListTile(contentPadding: EdgeInsets.zero, title: Text(r.name), value: selected.contains(r.id), onChanged: (v) => setState(() => v == true ? selected.add(r.id) : selected.remove(r.id)))).toList())),
      ]))),
      const SizedBox(height: 14), for (final k in ['co2', 'temp', 'hum', 'reset']) Padding(padding: const EdgeInsets.only(bottom: 10), child: OutlinedButton(onPressed: busy ? null : () => simulate(k), child: Text(k == 'reset' ? 'Reset readings' : 'Simulate high ${metricNames[k]}'))),
    ]);
  }
}

class UsersPage extends StatefulWidget {
  const UsersPage({required this.model, super.key});
  final AppModel model;
  @override
  State<UsersPage> createState() => _UsersPageState();
}
class _UsersPageState extends State<UsersPage> {
  int formVersion = 0;
  Widget table(String title, List<Account> people, {bool admin = false}) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    SectionTitle('$title (${people.length})'), SzCard(padding: EdgeInsets.zero, child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: DataTable(
      headingRowColor: WidgetStatePropertyAll(Theme.of(context).colorScheme.primary.withAlpha(18)),
      columns: (admin ? ['Name', 'Username', 'Email', 'Mobile number'] : ['Email', 'Mobile number']).map((h) => DataColumn(label: Text(h, style: const TextStyle(fontWeight: FontWeight.w700)))).toList(),
      rows: people.map((u) => DataRow(cells: (admin ? [u.name, u.username, u.email, u.phone] : [u.email, u.phone]).map((v) => DataCell(Text(v.isEmpty ? '—' : v))).toList())).toList(),
    ))), if (people.isEmpty) const Padding(padding: EdgeInsets.only(top: 8), child: Note('No accounts in this group yet.')),
  ]);
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: widget.model, builder: (_, _) => Scaffold(
    appBar: AppBar(title: const Text('Manage Users')),
    body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(18), child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 620), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Note('Registered accounts, grouped by role. Scroll tables sideways to see all columns.'),
      table('Admins', widget.model.accounts.where((u) => u.isAdmin).toList(), admin: true),
      table('Faculty', widget.model.accounts.where((u) => !u.isAdmin && u.kind == 'faculty').toList()),
      table('Students', widget.model.accounts.where((u) => !u.isAdmin && u.kind == 'student').toList()),
      const SectionTitle('Add another admin'), EntryForm(key: ValueKey(formVersion), fields: const [FieldSpec('fullName', 'Full name'), FieldSpec('username', 'Username'), FieldSpec('email', 'PUP web mail', email: true), FieldSpec('phone', 'Mobile number', phone: true), FieldSpec('password', 'Password', password: true), FieldSpec('confirmation', 'Confirm password', password: true)],
        submit: 'Create admin account', footer: const Note(passwordHint), onSubmit: (v) async {
          validatePassword(v['password']!, v['confirmation']!); await widget.model.mutate('/admin/users', body: v);
          if (mounted && context.mounted) { setState(() => formVersion++); message(context, 'Admin account created'); }
        }),
    ]))))),
  ));
}

class AccountPage extends StatelessWidget {
  const AccountPage({required this.model, super.key});
  final AppModel model;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: model, builder: (context, _) => accountBody(context));
  Widget accountBody(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Account Settings')), body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(18), child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 520), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(model.user?.name ?? '', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)), const SizedBox(height: 6), Note(model.user?.email ?? '')])),
    const SectionTitle('PUP web mail'), EntryForm(fields: [FieldSpec('email', 'PUP web mail', email: true, initial: model.user?.email ?? '')], submit: 'Save web mail', onSubmit: (v) async {
      await model.updateEmail(v['email']!); if (context.mounted) message(context, 'Web mail saved');
    }),
    const SectionTitle('Change password'), EntryForm(fields: const [FieldSpec('current', 'Current password', password: true), FieldSpec('next', 'New password', password: true), FieldSpec('confirm', 'Confirm new password', password: true)], footer: const Note(passwordHint), submit: 'Change password', onSubmit: (v) async {
      validatePassword(v['next']!, v['confirm']!); await model.changePassword(v['current']!, v['next']!); if (context.mounted) { Navigator.pop(context); message(context, 'Password updated'); }
    }),
  ]))))));
}

class RecipientsPage extends StatefulWidget {
  const RecipientsPage({required this.model, super.key});
  final AppModel model;
  @override
  State<RecipientsPage> createState() => _RecipientsPageState();
}
class _RecipientsPageState extends State<RecipientsPage> {
  Map<String, dynamic>? editing;
  String role = recipientRoles.first;
  int version = 0;
  bool busy = false;
  Future<void> remove(Map<String, dynamic> recipient) async {
    final yes = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(title: Text('Remove ${recipient['name']}?'), content: const Text('Remove this person from the SMS contact list?'), actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remove'))]));
    if (yes != true || busy) return;
    setState(() => busy = true);
    try { await widget.model.mutate('/sms-recipients/${recipient['id']}', method: 'DELETE', body: {}); if (editing?['id'] == recipient['id']) setState(() { editing = null; version++; }); }
    catch (e) { if (mounted) message(context, '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: widget.model, builder: (_, _) => Scaffold(
    appBar: AppBar(title: const Text('SMS Alerts')), body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(18), child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 520), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Note('SMS contacts are people on your notification list, not necessarily registered users. Real SMS delivery is not connected.'),
      for (final person in widget.model.recipients) Padding(padding: const EdgeInsets.only(top: 12), child: SzCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${person['name']}', style: const TextStyle(fontWeight: FontWeight.w700)), Note('${recipientRole(person['role'])} · ${person['phone']}'),
        Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Switch(value: person['smsEnabled'] == true, onChanged: busy ? null : (v) async {
            setState(() => busy = true);
            try { await widget.model.mutate('/sms-recipients/${person['id']}', method: 'PATCH', body: {'smsEnabled': v}); }
            catch (e) { if (context.mounted) message(context, '$e'); }
            finally { if (mounted) setState(() => busy = false); }
          }),
          TextButton.icon(onPressed: busy ? null : () => setState(() { editing = person; role = recipientRole(person['role']); version++; }), icon: const Icon(Icons.edit_outlined), label: const Text('Edit')),
          IconButton(tooltip: 'Remove ${person['name']}', onPressed: busy ? null : () => remove(person), icon: const Icon(Icons.delete_outline)),
        ]),
      ]))),
      SectionTitle(editing == null ? 'Add SMS contact' : 'Edit SMS contact'),
      EntryForm(key: ValueKey(version), fields: [FieldSpec('name', 'Full name', initial: '${editing?['name'] ?? ''}'), FieldSpec('phone', 'Mobile number', phone: true, initial: '${editing?['phone'] ?? ''}')],
        footer: DropdownButtonFormField<String>(initialValue: role, decoration: const InputDecoration(labelText: 'Role'), items: recipientRoles.map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(), onChanged: (v) => role = v ?? 'Other'),
        submit: 'Save contact', onSubmit: (v) async {
          await widget.model.mutate('/sms-recipients${editing == null ? '' : '/${editing!['id']}'}', method: editing == null ? 'POST' : 'PATCH', body: {...v, 'role': role});
          if (mounted && context.mounted) { setState(() { editing = null; role = recipientRoles.first; version++; }); message(context, 'SMS contact saved'); }
        }),
      if (editing != null) TextButton(onPressed: () => setState(() { editing = null; role = recipientRoles.first; version++; }), child: const Text('Cancel editing')),
    ]))))),
  ));
}
