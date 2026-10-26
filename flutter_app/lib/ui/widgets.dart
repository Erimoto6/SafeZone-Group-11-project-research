import 'dart:convert';
import 'package:flutter/material.dart';
import '../data/models.dart';

ThemeData safeZoneTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final surface = dark ? const Color(0xFF241519) : Colors.white;
  final ink = dark ? const Color(0xFFF5E8EC) : const Color(0xFF2A1319);
  final muted = dark ? const Color(0xFFB79EA6) : const Color(0xFF76606A);
  final line = dark ? const Color(0xFF3D2830) : const Color(0xFFEBD9DF);
  final brand = dark ? const Color(0xFFF29BB6) : const Color(0xFF7A1235);
  final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF7A1235), brightness: brightness)
      .copyWith(primary: brand, surface: surface, onSurface: ink, onSurfaceVariant: muted, outline: line);
  return ThemeData(
    useMaterial3: true, brightness: brightness, colorScheme: scheme,
    scaffoldBackgroundColor: dark ? const Color(0xFF170E11) : const Color(0xFFFBF3F5),
    dividerColor: line,
    appBarTheme: const AppBarTheme(backgroundColor: Color(0xFF7A1235), foregroundColor: Colors.white, elevation: 0, centerTitle: false),
    textTheme: ThemeData(brightness: brightness).textTheme.apply(bodyColor: ink, displayColor: ink),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: surface, contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: brand, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
      backgroundColor: const Color(0xFF7A1235), foregroundColor: Colors.white,
      minimumSize: const Size.fromHeight(50), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
    )),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(
      minimumSize: const Size(44, 46), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      side: BorderSide(color: line),
    )),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: surface, indicatorColor: brand.withAlpha(30),
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: s.contains(WidgetState.selected) ? brand : muted)),
    ),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
  );
}

Color statusColor(String level, BuildContext context) => switch (level) {
  'exceeded' => Theme.of(context).brightness == Brightness.dark ? const Color(0xFFFF8A80) : const Color(0xFFB3261E),
  'warning' => Theme.of(context).brightness == Brightness.dark ? const Color(0xFFF2D14B) : const Color(0xFF7A5B00),
  _ => Theme.of(context).brightness == Brightness.dark ? const Color(0xFF6FD39A) : const Color(0xFF1E7A45),
};
String levelName(String level) => level == 'exceeded' ? 'Danger' : level == 'warning' ? 'Warning' : 'Normal';
void message(BuildContext context, String text) => ScaffoldMessenger.of(context)
  ..hideCurrentSnackBar()
  ..showSnackBar(SnackBar(content: Text(text)));

class SzCard extends StatelessWidget {
  const SzCard({required this.child, this.padding = const EdgeInsets.all(16), super.key});
  final Widget child;
  final EdgeInsetsGeometry padding;
  @override
  Widget build(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.surface,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: Theme.of(context).dividerColor)),
    clipBehavior: Clip.antiAlias,
    child: Padding(padding: padding, child: child),
  );
}
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 22, bottom: 10),
    child: Text(text, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant)));
}
class Note extends StatelessWidget {
  const Note(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(text, style: TextStyle(fontSize: 12, height: 1.5, color: Theme.of(context).colorScheme.onSurfaceVariant));
}
class StatusPill extends StatelessWidget {
  const StatusPill(this.level, {super.key});
  final String level;
  @override
  Widget build(BuildContext context) => Align(alignment: Alignment.centerLeft, child: Container(
    decoration: BoxDecoration(color: statusColor(level, context).withAlpha(28), borderRadius: BorderRadius.circular(30)),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    child: Text(levelName(level), style: TextStyle(color: statusColor(level, context), fontWeight: FontWeight.w700, fontSize: 12)),
  ));
}
class Logo extends StatelessWidget {
  const Logo({this.size = 90, super.key});
  final double size;
  @override
  Widget build(BuildContext context) => Image.asset('assets/logo.png', width: size, height: size, fit: BoxFit.contain,
    errorBuilder: (_, _, _) => Icon(Icons.health_and_safety_outlined, size: size, color: Theme.of(context).colorScheme.primary));
}

class FieldSpec {
  const FieldSpec(this.name, this.label, {this.password = false, this.email = false, this.phone = false, this.required = true, this.initial = ''});
  final String name, label, initial;
  final bool password, email, phone, required;
}
class EntryForm extends StatefulWidget {
  const EntryForm({required this.fields, required this.submit, required this.onSubmit, this.footer, super.key});
  final List<FieldSpec> fields;
  final String submit;
  final Future<void> Function(Map<String, String>) onSubmit;
  final Widget? footer;
  @override
  State<EntryForm> createState() => _EntryFormState();
}
class _EntryFormState extends State<EntryForm> {
  final form = GlobalKey<FormState>();
  final Map<String, TextEditingController> values = {};
  final Set<String> visible = {};
  bool busy = false;
  String error = '';
  @override
  void initState() { super.initState(); for (final f in widget.fields) { values[f.name] = TextEditingController(text: f.initial); } }
  @override
  void dispose() { for (final c in values.values) { c.clear(); c.dispose(); } super.dispose(); }
  Future<void> save() async {
    if (busy || !form.currentState!.validate()) return;
    FocusScope.of(context).unfocus(); setState(() { busy = true; error = ''; });
    try { await widget.onSubmit(values.map((k,v) => MapEntry(k, v.text))); }
    catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Form(key: form, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    for (final f in widget.fields) Padding(padding: const EdgeInsets.only(bottom: 14), child: TextFormField(
      controller: values[f.name], obscureText: f.password && !visible.contains(f.name),
      autocorrect: !f.password && !f.email, enableSuggestions: !f.password,
      textCapitalization: f.password || f.email ? TextCapitalization.none : TextCapitalization.none,
      keyboardType: f.email ? TextInputType.emailAddress : f.phone ? TextInputType.phone : TextInputType.text,
      decoration: InputDecoration(labelText: f.label, prefixIcon: Icon(f.password ? Icons.lock_outline : f.email ? Icons.mail_outline : f.phone ? Icons.phone_outlined : Icons.person_outline),
        suffixIcon: f.password ? IconButton(tooltip: visible.contains(f.name) ? 'Hide password' : 'Show password', onPressed: () => setState(() => visible.contains(f.name) ? visible.remove(f.name) : visible.add(f.name)), icon: Icon(visible.contains(f.name) ? Icons.visibility_off_outlined : Icons.visibility_outlined)) : null),
      validator: (v) => f.required && (v ?? '').trim().isEmpty ? 'Enter ${f.label.toLowerCase()}.' : null,
      onFieldSubmitted: (_) { if (f == widget.fields.last) save(); },
    )),
    if (widget.footer != null) Padding(padding: const EdgeInsets.only(bottom: 14), child: widget.footer),
    if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error))),
    FilledButton(onPressed: busy ? null : save, child: busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(widget.submit)),
  ]));
}
void validatePassword(String password, String confirmation) {
  if (password.length < 6 || utf8.encode(password).length > 72 || !RegExp('[A-Za-z]').hasMatch(password) || !RegExp(r'\d').hasMatch(password) || RegExp(r'\s').hasMatch(password)) {
    throw Exception('Use 6–72 bytes with a letter and a number, and no spaces.');
  }
  if (password != confirmation) throw Exception('The two passwords do not match.');
}
const passwordHint = 'At least 6 characters, including a letter and a number. No spaces. Maximum 72 UTF-8 bytes.';

class RoomSelector extends StatelessWidget {
  const RoomSelector({required this.rooms, required this.selected, required this.onSelect, this.onAdd, super.key});
  final List<Room> rooms;
  final Room selected;
  final ValueChanged<int> onSelect;
  final VoidCallback? onAdd;
  @override
  Widget build(BuildContext context) => Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
    Expanded(child: SzCard(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), child: Row(children: [
      Icon(Icons.apartment_outlined, color: Theme.of(context).colorScheme.primary), const SizedBox(width: 10),
      Expanded(child: DropdownButtonHideUnderline(child: DropdownButton<int>(isExpanded: true, value: selected.id,
        itemHeight: ((MediaQuery.textScalerOf(context).scale(11) + MediaQuery.textScalerOf(context).scale(17)) * 1.2 + 8).clamp(48.0, double.infinity).toDouble(),
        hint: const Text('Select room'), items: rooms.map((r) => DropdownMenuItem(value: r.id, child: Text(r.name, overflow: TextOverflow.ellipsis))).toList(),
        selectedItemBuilder: (_) => rooms.map((r) => Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Select Room, ${floorName(r.floor)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, height: 1.2)),
          Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, height: 1.2, fontWeight: FontWeight.w700)),
        ])).toList(), onChanged: (id) { if (id != null) onSelect(id); }))),
      Icon(Icons.circle, size: 9, color: statusColor(selected.worst, context)),
    ]))),
    if (onAdd != null) Padding(padding: const EdgeInsets.only(left: 12), child: Column(children: [
      IconButton.filled(tooltip: 'Add room', onPressed: onAdd, icon: const Icon(Icons.add)),
      const Text('Add Room', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
    ])),
  ]);
}
