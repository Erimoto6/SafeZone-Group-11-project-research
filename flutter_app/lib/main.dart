import 'package:flutter/material.dart';
import 'data/app_model.dart';
import 'ui/auth.dart';
import 'ui/pages.dart';
import 'ui/settings.dart';
import 'ui/widgets.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SafeZoneApp());
}

class SafeZoneApp extends StatefulWidget {
  const SafeZoneApp({this.model, super.key});
  final AppModel? model;
  @override
  State<SafeZoneApp> createState() => _SafeZoneAppState();
}
class _SafeZoneAppState extends State<SafeZoneApp> with WidgetsBindingObserver {
  late final AppModel model;
  final navigatorKey = GlobalKey<NavigatorState>();
  bool signedIn = false;
  @override
  void initState() { super.initState(); model = widget.model ?? AppModel(); WidgetsBinding.instance.addObserver(this); signedIn = model.user != null; model.addListener(sessionChanged); model.initialize(); }
  void sessionChanged() {
    if (signedIn && model.user == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) navigatorKey.currentState?.popUntil((route) => route.isFirst); });
    }
    signedIn = model.user != null;
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) { model.resume(); model.poll(); } else { model.pause(); }
  }
  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); model.removeListener(sessionChanged); if (widget.model == null) model.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: model, builder: (_, _) => MaterialApp(
    navigatorKey: navigatorKey, title: 'SafeZone', debugShowCheckedModeBanner: false,
    theme: safeZoneTheme(Brightness.light), darkTheme: safeZoneTheme(Brightness.dark), themeMode: model.themeMode,
    home: model.loading ? const Scaffold(body: Center(child: CircularProgressIndicator()))
      : model.user == null ? AuthFlow(model: model) : SafeZoneShell(model: model),
  ));
}

class SafeZoneShell extends StatefulWidget {
  const SafeZoneShell({required this.model, super.key});
  final AppModel model;
  @override
  State<SafeZoneShell> createState() => _SafeZoneShellState();
}
class _SafeZoneShellState extends State<SafeZoneShell> {
  int index = 0;
  void account() => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => AccountPage(model: widget.model)));
  void users() async {
    try { await widget.model.refreshAdmin(); if (mounted) Navigator.push(context, MaterialPageRoute<void>(builder: (_) => UsersPage(model: widget.model))); }
    catch (e) { if (mounted) message(context, '$e'); }
  }
  @override
  Widget build(BuildContext context) {
    final m = widget.model;
    final titles = m.isAdmin ? ['SafeZone', 'Alerts', 'Monitoring', 'Devices', 'Settings'] : ['SafeZone', 'Alerts', 'Monitoring', 'About'];
    final icons = m.isAdmin ? [Icons.home_outlined, Icons.notifications_none, Icons.bar_chart, Icons.memory, Icons.tune] : [Icons.home_outlined, Icons.notifications_none, Icons.bar_chart, Icons.info_outline];
    final current = index < titles.length ? index : 0;
    final pages = [
      HomePage(model: m, onMonitor: () => setState(() => index = 2)), AlertsPage(model: m), MonitorPage(model: m),
      if (m.isAdmin) DevicesPage(model: m) else const AboutPage(),
      if (m.isAdmin) SettingsPage(model: m, onUsers: users, onAccount: account,
        onRecipients: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => RecipientsPage(model: m)))),
    ];
    return Scaffold(
      appBar: AppBar(title: Row(children: [if (current == 0) ...[const Logo(size: 30), const SizedBox(width: 10)], Flexible(child: Text(titles[current], overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)))]),
        actions: [PopupMenuButton<String>(tooltip: 'Menu', icon: const Icon(Icons.menu), onSelected: (action) async {
          if (action == 'account') { account(); }
          else if (action == 'about') { Navigator.push(context, MaterialPageRoute<void>(builder: (_) => Scaffold(appBar: AppBar(title: const Text('About SafeZone')), body: const SingleChildScrollView(padding: EdgeInsets.all(18), child: AboutPage())))); }
          else if (action == 'theme') { await m.setTheme(m.themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark); }
          else if (action == 'logout') { await m.logout(); }
        }, itemBuilder: (_) => [const PopupMenuItem(value: 'account', child: Text('Account Settings')), const PopupMenuItem(value: 'theme', child: Text('Switch light / dark theme')), const PopupMenuItem(value: 'about', child: Text('About SafeZone')), const PopupMenuItem(value: 'logout', child: Text('Log out'))])],
      ),
      body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 560), child: Column(children: [
        if (m.syncError.isNotEmpty) MaterialBanner(content: Text('Readings may be out of date. ${m.syncError}', style: const TextStyle(fontSize: 12)), actions: [TextButton(onPressed: () => m.poll(), child: const Text('Retry'))]),
        if (m.room == null) Expanded(child: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [const Text('No rooms could be loaded.'), TextButton(onPressed: () async { try { await m.refresh(); } catch (e) { if (context.mounted) message(context, '$e'); } }, child: const Text('Try again'))]))))
        else Expanded(child: IndexedStack(index: current, children: pages.asMap().entries.map((entry) => RefreshIndicator(
          onRefresh: m.refresh,
          child: SingleChildScrollView(key: PageStorageKey('page-${entry.key}'), physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 18, 16, 28), child: entry.value),
        )).toList())),
      ])))),
      bottomNavigationBar: NavigationBar(selectedIndex: current, onDestinationSelected: (v) => setState(() { index = v; if (v == 1) m.readAlerts(); }),
        destinations: List.generate(titles.length, (i) => NavigationDestination(icon: i == 1 && m.unread > 0 ? Badge(label: Text('${m.unread > 99 ? '99+' : m.unread}'), child: Icon(icons[i])) : Icon(icons[i]), label: i == 0 ? 'Home' : titles[i])),
      ),
    );
  }
}
