import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/localization.dart';
import '../core/utils/code_validator.dart';

/// Hand-maintained strings for Stage 3 gate/auth. Full `i18n.js` port in a later stage.
class L10n {
  L10n(this._lang);

  final String _lang;
  bool get _ar => _lang == 'ar';

  String get appTitle => _ar ? 'ليالينا السينمائية' : 'Our Movie Nights';
  String get appDescription => _ar
      ? 'قائمة مشاهدة شخصية للأفلام والمسلسلات والأنمي مرتبة حسب التصنيف.'
      : 'Personal watchlist of movies, TV series, and anime organized by genre.';

  String get gatePendingShare => _ar
      ? 'لديك قائمة مشتركة بانتظارك. سجّل الدخول أو أنشئ حساباً لاستيرادها.'
      : 'You have a shared list waiting. Sign in or create an account to import it.';
  String get gateLogin => _ar ? 'تسجيل الدخول' : 'Log in';
  String get gateCreate => _ar ? 'إنشاء حساب جديد' : 'Create new account';
  String get gateCodeLabel => _ar ? 'رمزك الشخصي' : 'Your personal code';
  String get gateChooseCode => _ar ? 'اختر رمزاً' : 'Choose a code';
  String get gateConfirmCode => _ar ? 'أكّد الرمز' : 'Confirm code';
  String get gateRecoveryWarning => _ar
      ? 'احفظ رمزك في مكان آمن. لا يمكن استرداده إذا نسيته.'
      : 'Save your code somewhere safe. It cannot be recovered if you forget it.';
  String get gateSubmitLogin => _ar ? 'دخول' : 'Sign in';
  String get gateSubmitCreate => _ar ? 'إنشاء الحساب' : 'Create account';
  String get gateShowCode => _ar ? 'إظهار الرمز' : 'Show code';
  String get gateHideCode => _ar ? 'إخفاء الرمز' : 'Hide code';
  String get gateRulesLabel => _ar ? 'متطلبات الرمز' : 'Code requirements';
  String get gateRuleLength => _ar ? '6 أحرف أو أكثر' : '6+ characters';
  String get gateRuleChars => _ar ? 'حروف وأرقام' : 'Letters and numbers';
  String get gateRuleSpaces => _ar ? 'بدون مسافات' : 'No spaces';
  String get gateRuleCaps =>
      _ar ? 'حالة الأحرف لا تهم' : "Capitalization doesn't matter";

  String get watchlistPlaceholder => _ar
      ? 'قائمة المشاهدة — المرحلة 4 ستعرض العناوين هنا.'
      : 'Watchlist — titles load in Stage 4.';
  String get signedInAs => _ar ? 'مسجّل الدخول كـ' : 'Signed in as';
  String get menuSignOut => _ar ? 'تسجيل الخروج' : 'Sign out';
  String get menuSwitchList => _ar ? 'تبديل القائمة' : 'Switch list';
  String get manageListsTitle => _ar ? 'إدارة القوائم' : 'Manage lists';
  String get manageCreate => _ar ? 'إنشاء قائمة جديدة' : 'Create a new list';
  String get manageUnnamedList => _ar ? 'قائمة بدون اسم' : 'Unnamed list';
  String get manageSignedInNow => _ar ? 'مسجل الدخول الآن' : 'Signed in now';
  String get manageSwitchToList => _ar ? 'فتح القائمة' : 'Open list';
  String get createNewList => _ar ? 'قائمة جديدة' : 'New list';
  String get createEditList => _ar ? 'تعديل القائمة' : 'Edit list';
  String get createName => _ar ? 'الاسم' : 'Name';
  String get createNamePlaceholder =>
      _ar ? 'أفلام كلاسيكية' : 'Classic movies';
  String get createAbout => _ar ? 'عن هذه القائمة' : 'About this list';
  String get createAboutPlaceholder => _ar
      ? 'اختيارات هوليوود القديمة لليالي الممطرة'
      : 'Old Hollywood picks for rainy nights';
  String get deleteListTitle => _ar ? 'حذف القائمة؟' : 'Delete list?';
  String deleteListConfirm({required String name, required int count}) => _ar
      ? 'حذف «$name» ($count عنوان)؟ لا يمكن التراجع عن هذا.'
      : 'Delete “$name” ($count ${count == 1 ? 'title' : 'titles'})? This cannot be undone.';
  String get syncCloud => _ar ? 'مزامنة سحابية' : 'Cloud sync';
  String get syncLocal => _ar ? 'محلي فقط' : 'Local only';

  String get typeAll => _ar ? 'الكل' : 'All';
  String get typeMovies => _ar ? 'أفلام' : 'Movies';
  String get typeTv => _ar ? 'مسلسلات' : 'TV';
  String get typeAnime => _ar ? 'أنمي' : 'Anime';

  String get statsTotal => _ar ? 'عناوين' : 'titles';
  String get statsWatched => _ar ? 'مشاهَد' : 'watched';

  String get cardWatched => _ar ? 'مشاهَد' : 'Watched';
  String get cardUnwatched => _ar ? 'غير مشاهَد' : 'Unwatched';

  String get syncSaving => _ar ? 'جاري الحفظ…' : 'Saving…';
  String get syncFailed => _ar ? 'فشل المزامنة' : 'Sync failed';
  String get syncOffline => _ar ? 'غير متصل' : 'Offline';

  String get emptyListTitle => _ar ? 'قائمتك فارغة' : 'Your list is empty';
  String get emptyListBody => _ar
      ? 'اضغط + لإضافة أول عنوان إلى قائمتك.'
      : 'Tap + to add your first title to the list.';

  String get addTitle => _ar ? 'إضافة عنوان' : 'Add title';
  String get addTabSearch => _ar ? 'بحث' : 'Search';
  String get addTabManual => _ar ? 'يدوي' : 'Manual';
  String get titleSearchPlaceholder => _ar
      ? 'مثال: Avengers، Demon Slayer…'
      : 'e.g. Avengers, Demon Slayer…';
  String get titleSearchType => _ar ? 'النوع' : 'Type';
  String get titleSearchTypeAll => _ar ? 'الكل' : 'All';
  String get searchConfirmTitle => _ar ? 'تأكيد العنوان' : 'Confirm title';
  String get fieldType => _ar ? 'النوع' : 'Type';
  String searchFoundMany(int count) => _ar
      ? 'وُجد $count نتيجة'
      : 'Found $count matches';
  String get editTitle => _ar ? 'تعديل العنوان' : 'Edit title';
  String get btnSave => _ar ? 'حفظ' : 'Save';
  String get btnDelete => _ar ? 'حذف' : 'Delete';
  String get btnCreateList => _ar ? 'إنشاء قائمة' : 'Create list';
  String get cardEdit => _ar ? 'تعديل' : 'Edit';
  String get fieldGenre => _ar ? 'التصنيف' : 'Genre';
  String get fieldTitle => _ar ? 'العنوان' : 'Title';
  String get fieldLead => _ar ? 'الممثل / الطاقم' : 'Lead actor / cast';
  String get fieldSummary => _ar ? 'ملخص' : 'Summary';
  String get fieldLink => _ar ? 'رابط (اختياري)' : 'Link (optional)';
  String get fieldWatched => _ar ? 'مشاهَد' : 'Watched';
  String get fieldRating => _ar ? 'تقييمك (0–10)' : 'Your rating (0–10)';
  String get fieldWatchNote => _ar ? 'ملاحظة (اختياري)' : 'Note (optional)';
  String get deleteTitleTitle => _ar ? 'حذف العنوان' : 'Delete title';
  String deleteTitleConfirm(String name) => _ar
      ? 'حذف «$name» من قائمتك؟'
      : 'Delete “$name” from your list?';
  String get emptyFilter => _ar
      ? 'لا توجد عناوين في هذا التصنيف.'
      : 'No titles in this category.';

  String get searchPlaceholder => _ar
      ? 'ابحث في العناوين أو أسماء الممثلين…'
      : 'Search titles or actors…';
  String get filterAll => _ar ? 'الكل' : 'All';
  String get filterWatched => _ar ? 'مشاهَد' : 'Watched';
  String get filterUnwatched => _ar ? 'غير مشاهَد' : 'Not watched';
  String get filterSortBy => _ar ? 'ترتيب حسب' : 'Sort by';
  String get filterSortDirection => _ar ? 'اتجاه الترتيب' : 'Sort direction';
  String get sortNewestFirst => _ar ? 'الأحدث أولاً' : 'Newest first';
  String get sortOldestFirst => _ar ? 'الأقدم أولاً' : 'Oldest first';
  String get sortHighestFirst => _ar ? 'الأعلى أولاً' : 'Highest first';
  String get sortLowestFirst => _ar ? 'الأدنى أولاً' : 'Lowest first';
  String get cardReleaseYear => _ar ? 'سنة الإصدار' : 'Release year';

  String sortDirectionLabel(String sortSource, String sortDirection) {
    if (sortSource == 'added' || sortSource == 'release') {
      return sortDirection == 'oldest' ? sortOldestFirst : sortNewestFirst;
    }
    if (sortSource == 'imdb' ||
        sortSource == 'anilist' ||
        sortSource == 'personal') {
      return sortDirection == 'worst' ? sortLowestFirst : sortHighestFirst;
    }
    return filterSortDirection;
  }

  String sortFilterLabel(String value) => switch (value) {
        'all' => _ar ? 'الترتيب الافتراضي' : 'Default order',
        'added' => _ar ? 'أُضيف مؤخراً' : 'Recently added',
        'release' => _ar ? 'تاريخ الإصدار' : 'Release date',
        'imdb' => _ar ? 'تقييمات IMDb' : 'IMDb ratings',
        'anilist' => _ar ? 'تقييم AniList' : 'AniList rating',
        'personal' => _ar ? 'تقييماتي' : 'My ratings',
        _ => value,
      };
  String get filterByGenre => _ar
      ? 'تصفية حسب التصنيف (أساسي أو ثانوي)'
      : 'Filter by genre (primary or secondary)';
  String get filterAddGenre => _ar ? 'إضافة تصنيف…' : 'Add genre…';
  String get filterClear => _ar ? 'مسح الفلاتر' : 'Clear filters';
  String get emptySearch => _ar
      ? 'لا توجد نتائج لهذا البحث أو الفلتر.'
      : 'No results for this search or filter.';

  String ratingFilterLabel(String value) => switch (value) {
        'all' => _ar ? 'الترتيب الافتراضي' : 'Default order',
        'added-newest' => _ar ? 'أُضيف مؤخراً' : 'Recently added',
        'added-oldest' => _ar ? 'الأقدم أولاً' : 'Oldest first',
        'imdb-best' => _ar ? 'IMDb — الأعلى أولاً' : 'IMDb — highest first',
        'imdb-worst' => _ar ? 'IMDb — الأدنى أولاً' : 'IMDb — lowest first',
        'anilist-best' =>
          _ar ? 'AniList — الأعلى أولاً' : 'AniList — highest first',
        'anilist-worst' =>
          _ar ? 'AniList — الأدنى أولاً' : 'AniList — lowest first',
        'personal-best' =>
          _ar ? 'تقييمي — الأعلى أولاً' : 'My rating — highest first',
        'personal-worst' =>
          _ar ? 'تقييمي — الأدنى أولاً' : 'My rating — lowest first',
        _ => value,
      };

  String titleCount(int count) =>
      _ar ? '$count عنوان' : '$count ${count == 1 ? 'title' : 'titles'}';

  String contentTypeLabel(String contentType) => switch (contentType) {
        'movies' => typeMovies,
        'tvSeries' => typeTv,
        'anime' => typeAnime,
        _ => contentType,
      };

  String pendingShare(String id) =>
      _ar ? 'مشاركة معلّقة: $id' : 'Pending share: $id';

  String get shareTitle => _ar ? 'مشاركة قائمة' : 'Share a list';
  String get shareSend => _ar ? 'إرسال قائمتي' : 'Send my list';
  String get shareSendDesc =>
      _ar ? 'إنشاء رابط مشاركة لهذه القائمة' : 'Create a share link for this list';
  String get sharePublishing => _ar ? 'جاري إنشاء الرابط…' : 'Creating link…';
  String get shareArrivalTitle =>
      _ar ? 'قائمة مشتركة جاهزة للاستيراد' : 'Shared list ready to import';
  String get shareArrivalLoading =>
      _ar ? 'جاري تحميل القائمة المشتركة…' : 'Loading shared list…';
  String get shareArrivalImport => _ar ? 'مراجعة الاستيراد' : 'Review import';
  String get shareArrivalDismiss => _ar ? 'ليس الآن' : 'Not now';
  String shareArrivalText({required String name, required int count}) => _ar
      ? '«$name» تحتوي على $count عنواناً. اختر كيف تستوردها إلى حسابك.'
      : '“$name” has $count titles. Choose how to import it into your account.';
  String shareArrivalError(String key) => switch (key) {
        'expired' => _ar
            ? 'انتهت صلاحية رابط المشاركة.'
            : 'This share link has expired.',
        'empty' || 'import.empty' => _ar
            ? 'لا توجد عناوين في هذا الرابط.'
            : 'That link has no titles to import.',
        'share.needsCloud' => _ar
            ? 'الاستيراد من رابط يتطلب المزامنة السحابية.'
            : 'Importing from a link requires cloud sync.',
        _ => _ar
            ? 'رابط المشاركة غير صالح أو لم يعد متاحاً.'
            : 'This share link is invalid or no longer available.',
      };

  String get importTitle => _ar ? 'استيراد قائمة' : 'Import a list';
  String get importHint => _ar
      ? 'اختر طريقة الاستيراد. الإضافة لقائمتك الحالية تبقي عناوينك الحالية.'
      : 'Choose how to import. Adding to your current list keeps your existing titles.';
  String get importHintEmpty => _ar
      ? 'قائمتك فارغة — يمكنك إضافة العناوين المشتركة مباشرة.'
      : 'Your list is empty — you can add the shared titles directly.';
  String importSummaryWithCurrent({
    required String listName,
    required int count,
    required String currentName,
    required int currentCount,
  }) =>
      _ar
          ? '«$listName» فيها $count عنواناً. قائمتك الحالية «$currentName» فيها $currentCount عنواناً.'
          : '"$listName" has $count titles. Your current list "$currentName" has $currentCount titles.';
  String importSummaryEmpty({required String listName, required int count}) =>
      _ar
          ? '«$listName» فيها $count عنواناً. قائمتك الحالية فارغة.'
          : '"$listName" has $count titles. Your current list is empty.';
  String importSummaryWithDescription(String description) =>
      _ar ? 'الوصف: $description' : 'About: $description';
  String get importMerge =>
      _ar ? 'إضافة لقائمتي الحالية' : 'Add to my current list';
  String get importMergeWithWatch => _ar
      ? 'إضافة للقائمة الحالية مع التقييمات والملاحظات'
      : 'Add to current list with ratings and notes';
  String get importAddToList => _ar ? 'إضافة لهذه القائمة' : 'Add to this list';

  String importMergedMessage({required int added, required int skipped}) {
    if (skipped > 0) {
      return _ar
          ? 'أُضيف $added عنواناً. تُرك $skipped مكرراً.'
          : 'Added $added titles. Skipped $skipped duplicates.';
    }
    return _ar ? 'أُضيفت العناوين إلى قائمتك.' : 'Titles were added to your list.';
  }

  String importMergedWithWatchMessage({required int added, required int skipped}) {
    if (skipped > 0) {
      return _ar
          ? 'أُضيف $added عنواناً مع التقييمات. تُرك $skipped مكرراً.'
          : 'Added $added titles with ratings. Skipped $skipped duplicates.';
    }
    return _ar
        ? 'أُضيفت العناوين مع التقييمات والملاحظات.'
        : 'Titles were added with ratings and notes.';
  }

  String get shareLinkCopied =>
      _ar ? 'تم نسخ رابط المشاركة.' : 'Share link copied to clipboard.';
  String get shareCopyLink => _ar ? 'نسخ الرابط' : 'Copy link';
  String get sharePasteInAddressBar => _ar
      ? 'الصق الرابط في شريط عنوان المتصفح (ليس في بحث Google).'
      : 'Paste the link in your browser address bar (not in Google search).';
  String get shareCopyFailed => _ar
      ? 'تعذّر النسخ تلقائياً — حدّد الرابط أعلاه واضغط Ctrl+C.'
      : 'Could not copy automatically — select the link above and press Ctrl+C.';
  String shareLinkReady(String listName) => _ar
      ? 'تم إنشاء رابط مشاركة لـ «$listName». انسخه وأرسله لمن تريد.'
      : 'Share link created for “$listName”. Copy it and send it to someone.';
  String get shareDevHint => _ar
      ? 'وضع التطوير: يعمل الرابط على هذا الجهاز أو على نفس شبكة الواي فاي (مثلاً من الآيفون). للمشاركة مع أشخاص خارج شبكتك، انشر التطبيق على GitHub Pages واضبط publicAppUrl في config.js.'
      : 'Dev mode: this link works on this PC or on the same Wi‑Fi (e.g. iPhone). To share with people outside your network, deploy to GitHub Pages and set publicAppUrl in config.js.';
  String get shareDifferentAccountHint => _ar
      ? 'لاستيراد بحساب آخر: افتح الرابط في نافذة خاصة (Incognito) أو سجّل الخروج أولاً.'
      : 'To import with a different account: open the link in a private/incognito window, or sign out first.';
  String get shareListSharedTitle => _ar ? 'تمت المشاركة' : 'List shared';
  String get shareListUpdatedTitle => _ar ? 'تم تحديث القائمة' : 'List updated';
  String get shareBackupCopied => _ar
      ? 'لا يوجد اتصال سحابي — تم نسخ ملف النسخ الاحتياطي.'
      : 'No cloud connection — backup JSON copied to clipboard.';
  String get sharePublishFailed => _ar
      ? 'تعذّر إنشاء رابط المشاركة. جرّب تصدير ملف نسخ احتياطي.'
      : 'Could not create a share link. Try exporting a backup file instead.';
  String get shareLocalhost => _ar
      ? 'روابط المشاركة لا تعمل على localhost. استخدم عنوان IP للشبكة أو انشر الموقع.'
      : 'Share links do not work on localhost. Use your network IP or deploy the app.';

  String watchlistLoadError(String detail) => _ar
      ? 'تعذّر تحميل القائمة: $detail'
      : 'Could not load watchlist: $detail';

  String get aboutTitle => _ar ? 'حول التطبيق' : 'About';
  String get aboutBody => _ar
      ? 'تطبيق قائمة مشاهدة شخصية. البيانات من TMDb وOMDb وAniList.'
      : 'Personal watchlist app. Metadata from TMDb, OMDb, and AniList.';
  String get btnCancel => _ar ? 'إلغاء' : 'Cancel';
  String get btnOk => _ar ? 'حسناً' : 'OK';
  String get languageEn => 'English';
  String get languageAr => 'العربية';

  String message(String key) {
    switch (key) {
      case 'gate.noList':
        return _ar
            ? 'لا يوجد حساب بهذا الرمز. أنشئ حساباً جديداً.'
            : 'No account found with this code. Use Create new account to sign up.';
      case 'gate.codesMismatch':
        return _ar ? 'الرمزان غير متطابقين.' : 'Codes do not match.';
      case 'gate.codeExists':
        return _ar
            ? 'يوجد حساب بهذا الرمز. استخدم تسجيل الدخول بدلاً من ذلك.'
            : 'An account with this code already exists. Use Log in instead.';
      case 'gate.deleted':
        return _ar
            ? 'تم حذف الحساب. يمكنك إنشاء حساباً جديداً بنفس الرمز.'
            : 'Account deleted. You can create a new account with the same code.';
      case 'auth.spaces':
        return _ar ? 'المسافات غير مسموحة.' : 'Spaces are not allowed.';
      case 'auth.minLength':
        return _ar
            ? 'استخدم $minCodeLength أحرف على الأقل.'
            : 'Use at least $minCodeLength characters.';
      case 'auth.needLetter':
        return _ar ? 'استخدم حرفاً واحداً على الأقل.' : 'Use at least one letter.';
      case 'auth.needNumber':
        return _ar ? 'استخدم رقماً واحداً على الأقل.' : 'Use at least one number.';
      case 'watchlist.duplicate':
        return _ar
            ? 'هذا العنوان موجود بالفعل في القائمة.'
            : 'This title is already on your list.';
      case 'watchlist.syncFailed':
        return _ar
            ? 'تم الحفظ محلياً لكن فشلت المزامنة السحابية.'
            : 'Saved locally, but cloud sync failed.';
      case 'watchlist.invalidRating':
        return _ar ? 'استخدم تقييماً بين 0 و10.' : 'Use a rating between 0 and 10.';
      case 'watchlist.notSignedIn':
        return _ar ? 'يرجى تسجيل الدخول.' : 'Please sign in.';
      case 'watchlist.notLoaded':
        return _ar ? 'القائمة غير جاهزة بعد.' : 'Watchlist is not ready yet.';
      case 'watchlist.notFound':
        return _ar ? 'تعذّر العثور على العنوان.' : 'Could not find that title.';
      case 'share.needsCloud':
        return shareArrivalError('share.needsCloud');
      case 'share.publishFailed':
        return sharePublishFailed;
      case 'share.localhost':
        return shareLocalhost;
      case 'import.empty':
        return shareArrivalError('empty');
      case 'list.nameRequired':
        return _ar ? 'أعطِ قائمتك اسماً.' : 'Give your list a name.';
      case 'list.nameTooLong':
        return _ar
            ? 'اجعل الاسم أقل من 48 حرفاً.'
            : 'Keep the name under 48 characters.';
      case 'list.notFound':
        return _ar ? 'القائمة غير موجودة.' : 'List not found.';
      case 'search.notConfigured':
        return _ar
            ? 'البحث غير مهيأ. أضف مفاتيح OMDb أو TMDb.'
            : 'Search is not configured. Add OMDb or TMDb API keys.';
      case 'search.failed':
        return _ar ? 'فشل البحث.' : 'Search failed.';
      case 'search.noMatches':
        return _ar
            ? 'لا توجد نتائج. جرّب تهجئة أخرى.'
            : 'No matches found. Try another spelling.';
      case 'search.foundOne':
        return _ar ? 'وُجدت نتيجة واحدة' : 'Found 1 match';
      case 'search.loadingDetails':
        return _ar ? 'جاري تحميل التفاصيل…' : 'Loading details…';
      case 'search.loadFailed':
        return _ar
            ? 'تعذّر تحميل تفاصيل هذا العنوان.'
            : 'Could not load details for this title.';
      case 'search.incomplete':
        return _ar
            ? 'بيانات العنوان ناقصة.'
            : 'Title details are incomplete.';
      case 'search.missingActors':
        return _ar
            ? 'لا يوجد ممثل أو طاقم — أضف العنوان يدوياً.'
            : 'No cast found — add the title manually instead.';
      default:
        return key;
    }
  }
}

final l10nProvider = Provider<L10n>((ref) {
  final locale = ref.watch(localeProvider);
  return L10n(locale.languageCode);
});
