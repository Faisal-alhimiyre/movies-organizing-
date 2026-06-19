import 'clipboard_copy_stub.dart'
    if (dart.library.js_interop) 'clipboard_copy_web_impl.dart';

bool copyWithExecCommand(String text) => copyWithExecCommandImpl(text);
