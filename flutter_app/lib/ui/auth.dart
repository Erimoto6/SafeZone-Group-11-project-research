import 'package:flutter/material.dart';
import '../data/app_model.dart';
import 'widgets.dart';

class AuthFlow extends StatefulWidget {
  const AuthFlow({required this.model, super.key});
  final AppModel model;
  @override
  State<AuthFlow> createState() => _AuthFlowState();
}
class _AuthFlowState extends State<AuthFlow> {
  String stage = 'welcome';
  bool admin = false;
  Map<String, String> registration = {};
  String resetEmail = '', resetToken = '';
  void go(String next) => setState(() => stage = next);
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = switch (stage) {
      'login' => admin ? 'Admin Login' : 'Student / Faculty Login',
      'register' => 'Create Account',
      'password' => 'Create Password', 'done' => 'Account Created!',
      'forgot' => 'Forgot Password', 'code' => 'Verification Code',
      'reset' => 'New Password', 'resetDone' => 'Password Updated', _ => 'SafeZone',
    };
    return Scaffold(
      appBar: stage == 'welcome' ? null : AppBar(
        backgroundColor: theme.scaffoldBackgroundColor, surfaceTintColor: Colors.transparent,
        foregroundColor: theme.colorScheme.primary, elevation: 0, scrolledUnderElevation: 0,
        automaticallyImplyLeading: false, leadingWidth: 112,
        leading: TextButton.icon(onPressed: () => go(stage == 'password' ? 'register' : 'welcome'),
          icon: const Icon(Icons.chevron_left), label: const Text('Back')),
      ),
      body: SafeArea(child: LayoutBuilder(builder: (_, constraints) => SingleChildScrollView(
      padding: const EdgeInsets.all(24), child: ConstrainedBox(constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
      child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 400), child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Center(child: Logo()), const SizedBox(height: 18),
        if (stage != 'welcome') Text('SafeZone', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: theme.colorScheme.primary)),
        Text(title, textAlign: TextAlign.center, style: TextStyle(fontSize: stage == 'welcome' ? 38 : 23, fontWeight: FontWeight.w800, color: stage == 'welcome' ? theme.colorScheme.primary : null)),
        const SizedBox(height: 12),
        if (widget.model.startupError.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Note(widget.model.startupError)),
        if (stage == 'welcome') ...[
          const Text('A safer classroom. A healthier environment.', textAlign: TextAlign.center), const SizedBox(height: 36),
          FilledButton(onPressed: () { admin = false; go('login'); }, child: const Text('Student / Faculty')),
          const SizedBox(height: 14), OutlinedButton(onPressed: () { admin = true; go('login'); }, child: const Text('Admin')),
        ] else if (stage == 'login') ...[
          Text(admin ? 'Access the system to manage and control.' : 'Log in to view your classroom environment.', textAlign: TextAlign.center), const SizedBox(height: 26),
          EntryForm(key: ValueKey('login-$admin'), fields: [FieldSpec('identifier', admin ? 'Username' : 'Mobile number or PUP web mail'), const FieldSpec('password', 'Password', password: true)], submit: 'Log in',
            onSubmit: (v) => widget.model.login(v['identifier']!, v['password']!, admin)),
          TextButton(onPressed: () => go('forgot'), child: const Text('Forgot password?')),
          if (!admin) TextButton(onPressed: () => go('register'), child: const Text('Create an account')),
          const Note('Use an account created on your SafeZone server.'),
        ] else if (stage == 'register' && !admin) ...[
          const SizedBox(height: 16), EntryForm(key: const ValueKey('register-viewer'), fields: [
            FieldSpec('email', 'PUP web mail', email: true, initial: registration['email'] ?? ''),
            FieldSpec('phone', 'Mobile number (09XXXXXXXXX)', phone: true, initial: registration['phone'] ?? ''),
          ], footer: const Note('Students: @iskolarngbayan.pup.edu.ph\nFaculty: @pup.edu.ph'),
          submit: 'Continue', onSubmit: (v) async { registration = v; go('password'); }),
        ] else if (stage == 'password' && !admin) EntryForm(key: const ValueKey('password'), fields: const [FieldSpec('password', 'Password', password: true), FieldSpec('confirmation', 'Confirm password', password: true)],
          footer: const Note(passwordHint), submit: 'Create Account', onSubmit: (v) async {
            validatePassword(v['password']!, v['confirmation']!);
            await widget.model.api.request('/auth/register', method: 'POST', body: {...registration, 'password': v['password']}); registration = {}; go('done');
          })
        else if (stage == 'done' || stage == 'resetDone') ...[
          const Padding(padding: EdgeInsets.all(24), child: Icon(Icons.check_circle_outline, size: 56, color: Color(0xFF1E7A45))),
          const Text('You can now log in to SafeZone.', textAlign: TextAlign.center), const SizedBox(height: 24),
          FilledButton(onPressed: () => go('login'), child: const Text('Go to Login')),
        ] else if (stage == 'forgot') EntryForm(key: const ValueKey('forgot'), fields: const [FieldSpec('email', 'PUP web mail', email: true)], submit: 'Send verification code',
          onSubmit: (v) async { resetEmail = v['email']!.trim(); await widget.model.api.request('/auth/forgot', method: 'POST', body: {'email': resetEmail}); go('code'); })
        else if (stage == 'code') ...[
          const Note('If the address is registered, a six-digit code was requested. Check your inbox and Junk folder. Codes expire after 10 minutes.'), const SizedBox(height: 16),
          EntryForm(key: const ValueKey('code'), fields: const [FieldSpec('code', 'Six-digit code', phone: true)], submit: 'Verify code', onSubmit: (v) async {
            final result = await widget.model.api.request('/auth/verify-code', method: 'POST', body: {'email': resetEmail, 'code': v['code']!.trim()}); resetToken = '${result['resetToken']}'; go('reset');
          }),
          TextButton(onPressed: () async {
            try { await widget.model.api.request('/auth/forgot', method: 'POST', body: {'email': resetEmail}); if (context.mounted) message(context, 'A new code was requested. Wait 30 seconds before resending.'); }
            catch (e) { if (context.mounted) message(context, '$e'); }
          }, child: const Text('Resend code')),
        ] else if (stage == 'reset') EntryForm(key: const ValueKey('reset'), fields: const [FieldSpec('password', 'New password', password: true), FieldSpec('confirmation', 'Confirm password', password: true)],
          submit: 'Save new password', footer: const Note(passwordHint), onSubmit: (v) async {
            validatePassword(v['password']!, v['confirmation']!); await widget.model.api.request('/auth/reset', method: 'POST', body: {'resetToken': resetToken, 'newPassword': v['password']}); resetToken = ''; go('resetDone');
          }),
        const SizedBox(height: 28),
      ]))),
    )))));
  }
}
