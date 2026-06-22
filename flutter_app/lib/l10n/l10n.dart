import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/localization.dart';
import '../app/theme/theme_controller.dart';
import '../core/utils/code_validator.dart';
import '../core/utils/title_meta_format.dart';

/// Hand-maintained strings for Stage 3 gate/auth. Full `i18n.js` port in a later stage.
class L10n {
  L10n(this._lang);

  final String _lang;
  bool get _ar => _lang == 'ar';
  bool get isArabic => _ar;

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
  String get menuChangeCode => _ar ? 'تغيير الرمز' : 'Change code';
  String get menuDeleteAccount => _ar ? 'حذف الحساب' : 'Delete account';
  String get menuShare => _ar ? 'مشاركة' : 'Share';
  String get menuTheme => _ar ? 'المظهر' : 'Theme';
  String get menuLanguage => _ar ? 'اللغة' : 'Language';
  String get menuAccount => _ar ? 'الحساب' : 'Account';
  String get changeCodeTitle => _ar ? 'تغيير رمز القائمة' : 'Change list code';
  String get changeCodeText => _ar
      ? 'أفلامك تبقى كما هي. يتغيّر رمز الدخول فقط. 6 أحرف على الأقل، حروف وأرقام، بلا مسافات. لا يهمّ استخدام الأحرف الكبيرة.'
      : 'Your movies stay the same. Only the sign-in code changes. 6+ characters, letters and numbers, no spaces. Capitals don\'t matter.';
  String get changeCodeNew => _ar ? 'الرمز الجديد' : 'New code';
  String get changeCodeConfirm =>
      _ar ? 'تأكيد الرمز الجديد' : 'Confirm new code';
  String get btnUpdateCode => _ar ? 'تحديث الرمز' : 'Update code';
  String get codeUpgradeTitle =>
      _ar ? 'حدّث رمز الدخول' : 'Update your sign-in code';
  String get codeUpgradeBody => _ar
      ? 'رمزك القديم (مثل 1234) لم يعد يطابق القواعد الجديدة. اختر رمزاً شخصياً جديداً يحتوي حروفاً وأرقاماً — 6 أحرف على الأقل.'
      : 'Your old code (like 1234) no longer fits the new rules. Pick a new personal code with letters and numbers — at least 6 characters.';
  String get codeUpdatedTitle => _ar ? 'تم تحديث الرمز' : 'Code updated';
  String get codeUpdatedBody => _ar
      ? 'تم تحديث رمز الدخول. احفظه في مكان آمن.'
      : 'Your sign-in code was updated. Save it somewhere safe.';
  String get deleteAccountTitle => _ar ? 'حذف الحساب؟' : 'Delete account?';
  String deleteAccountConfirm(int listCount) => _ar
      ? 'حذف حسابك وكل قوائمك ($listCount)؟ سيصبح رمز الدخول متاحاً مجدداً.'
      : 'Delete your account and all $listCount ${listCount == 1 ? 'list' : 'lists'}? Your sign-in code will be free to use again.';
  String get deleteAccountPartialTitle =>
      _ar ? 'حذف جزئي' : 'Partially deleted';
  String get deleteAccountPartialBody => _ar
      ? 'أُزيل من هذا الجهاز، لكن حذف السحابة فشل. جرّب حذف الحساب مرة أخرى.'
      : 'Removed from this device, but cloud delete failed. Try Delete account once more.';
  String get menuSwitchList => _ar ? 'تبديل القائمة' : 'Switch list';
  String get manageListsTitle => _ar ? 'إدارة القوائم' : 'Manage lists';
  String get manageCreate => _ar ? 'إنشاء قائمة جديدة' : 'Create a new list';
  String get manageUnnamedList => _ar ? 'قائمة بدون اسم' : 'Unnamed list';
  String get manageSignedInNow => _ar ? 'مسجل الدخول الآن' : 'Signed in now';
  String get manageAssignDefault =>
      _ar ? 'تعيين كقائمة افتراضية' : 'Assign as default';
  String get manageDefaultList => _ar ? 'القائمة الافتراضية' : 'Default list';
  String get createNewList => _ar ? 'قائمة جديدة' : 'New list';
  String get createEditList => _ar ? 'تعديل القائمة' : 'Edit list';
  String get moveTitle => _ar ? 'نقل لقائمة أخرى' : 'Move to another list';
  String moveText(String title) => _ar
      ? 'تكرار «$title» في قائمة أخرى. القائمة الحالية تبقى كما هي.'
      : 'Duplicate “$title” to another list. Current list stays unchanged.';
  String get moveEmpty =>
      _ar ? 'أنشئ قائمة أخرى أولاً.' : 'Create another list first.';
  String get moveCopiedTitle => _ar ? 'تم النسخ للقائمة' : 'Copied to list';
  String moveCopied(String title, String listName) => _ar
      ? 'تم نسخ «$title» إلى $listName.'
      : '“$title” was copied to $listName.';
  String get moveCouldNotCopyTitle => _ar ? 'تعذر النقل' : 'Could not move';
  String get moveTitleNotFound =>
      _ar ? 'العنوان غير موجود.' : 'Title not found.';
  String get moveAlreadyOnThisList => _ar
      ? 'هذا العنوان موجود في هذه القائمة.'
      : 'That title is already on this list.';
  String moveAlreadyOnList(String title, String listName) => _ar
      ? '«$title» موجود في $listName.'
      : '“$title” is already on $listName.';
  String get createName => _ar ? 'الاسم' : 'Name';
  String get createNamePlaceholder => _ar ? 'أفلام كلاسيكية' : 'Classic movies';
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

  /// Short type label in genre section badges — mirrors `typeSectionShort()` on web.
  String typeSectionShort(String? contentType) => switch (contentType) {
        'movies' => _ar ? 'فيلم' : 'Movie',
        'tvSeries' => _ar ? 'مسلسل' : 'TV Series',
        'anime' => typeAnime,
        _ => '',
      };

  String get genreAllSelected => _ar ? 'كل المحدد' : 'All selected';

  String get statsTotal => _ar ? 'عناوين' : 'titles';
  String get statsWatched => _ar ? 'مشاهَد' : 'watched';

  String get cardWatched => _ar ? 'مشاهَد' : 'Watched';
  String get cardUnwatched => _ar ? 'غير مشاهَد' : 'Unwatched';
  String get cardRate => _ar ? 'قيّم' : 'Rate';
  String get cardMarkWatched => _ar ? 'تعيين كمشاهد' : 'Mark watched';
  String get cardMarkUnwatched => _ar ? 'تعيين كغير مشاهد' : 'Mark unwatched';
  String get cardMoveToList => _ar ? 'نقل لقائمة أخرى' : 'Move to another list';
  String get layoutHover => _ar ? 'معاينة عند التمرير' : 'Preview on hover';
  String get layoutPoster => _ar ? 'عرض صور الغلاف' : 'Show poster images';
  String get layoutToolbar => _ar ? 'شكل البطاقات' : 'Card layout';
  String get cardYourRating => _ar ? 'تقييمك' : 'Your rating';
  String get cardSectionDetails => _ar ? 'التفاصيل' : 'Details';
  String get cardSectionGenres => _ar ? 'الأنواع' : 'Genres';

  /// Friendly label for MPAA / TV parental ratings (raw code stored separately).
  String ageRatingLabel(String raw) =>
      formatAgeRatingDisplay(raw, arabic: _ar);
  String get cardOpenLink => _ar ? 'فتح الرابط' : 'Open link';
  String get typeFilmSeries => _ar ? 'سلسلة أفلام' : 'Film series';
  String get mobileNotWatched => _ar ? 'لم تُشاهد بعد' : 'Not watched yet';
  String get mobileWatchedUnrated =>
      _ar ? 'شُوهدت — لم تُقيَّم بعد' : 'Watched — not rated yet';
  String get mobileRateTitle => _ar ? 'قيّم هذا العنوان' : 'Rate this title';
  String get mobileEditRating => _ar ? 'تعديل التقييم' : 'Edit rating';
  String get mobileClose => _ar ? 'إغلاق' : 'Close';
  String get btnClose => mobileClose;

  // ─── Episode / season progress ────────────────────────────────────────────
  String get progressUnwatched => _ar ? 'لم تُشاهد' : 'Unwatched';
  String get progressInProgress => _ar ? 'قيد المشاهدة' : 'In progress';
  String get progressWatched => _ar ? 'مشاهَد' : 'Watched';
  String progressEpisodes(int watched, int total) =>
      _ar ? '$watched/$total حلقة' : '$watched/$total episodes';
  String get progressMarkSeasonWatched =>
      _ar ? 'تعيين الموسم كمشاهَد' : 'Mark season watched';
  String get progressUnmarkSeasonWatched =>
      _ar ? 'إلغاء تحديد الموسم' : 'Unmark season';
  String get progressSeasonPartial => _ar ? 'مشاهَد جزئياً' : 'Partially watched';
  String get progressMarkAllWatched => _ar ? 'تعيين الكل كمشاهَد' : 'Mark all watched';
  String get progressClearAllWatched => _ar ? 'إلغاء تحديد الكل' : 'Unwatch all';
  String get progressLoadingEpisodes =>
      _ar ? 'جارٍ تحميل الحلقات…' : 'Loading episodes…';
  String get progressLoadError => _ar ? 'تعذّر تحميل الحلقات.' : 'Could not load episodes.';
  String get progressOffline =>
      _ar ? 'أنت غير متصل بالإنترنت. بيانات الحلقات غير متاحة.'
          : 'You are offline. Episode data is unavailable.';
  String get progressRetry => _ar ? 'إعادة المحاولة' : 'Retry';
  String get progressSpecials => _ar ? 'حلقات خاصة' : 'Specials';
  String progressSeason(int n) => _ar ? 'الموسم $n' : 'Season $n';
  String get btnRateLater => _ar ? 'التقييم لاحقاً' : 'Rate later';
  String get btnSaveRating => _ar ? 'حفظ التقييم' : 'Save rating';
  String get ratingTitle => _ar ? 'تقييم العنوان' : 'Rate title';
  String ratingRateItem(String title) =>
      _ar ? 'قيّم «$title»' : 'Rate “$title”';
  String get ratingYourScore =>
      _ar ? 'تقييمك (من 10)' : 'Your rating (out of 10)';
  String get ratingStarsGroup =>
      _ar ? 'اضغط نجمة للتقييم من 10' : 'Tap a star to rate out of 10';
  String ratingStar(int n) => _ar ? '$n من 10' : '$n out of 10';
  String get ratingLower => _ar ? 'خفض التقييم 0.1' : 'Lower rating by 0.1';
  String get ratingRaise => _ar ? 'رفع التقييم 0.1' : 'Raise rating by 0.1';
  String get ratingFineTune => _ar ? 'ضبط دقيق' : 'Fine-tune';
  String get ratingChooseStarFirst => _ar
      ? 'اضغط نجمة لاختيار تقييمك أولاً.'
      : 'Tap a star to choose your score first.';
  String get ratingNote => _ar ? 'ملاحظة لنفسك' : 'Note for yourself';
  String get ratingNotePlaceholder => _ar
      ? 'ما الذي لفت انتباهك؟ هل ستشاهده مجدداً؟'
      : 'What stood out? Would you watch again?';
  String get markUnwatchedTitle =>
      _ar ? 'إزالة بيانات المشاهدة؟' : 'Remove watch data?';
  String get markUnwatchedConfirm => _ar
      ? 'تعيين كغير مشاهد؟ سيتم حذف تقييمك وملاحظتك لهذا العنوان.'
      : 'Mark as unwatched? Your rating and note for this title will be removed.';

  String get syncSaving => _ar ? 'جاري الحفظ…' : 'Saving…';
  String get syncFailed => _ar ? 'فشل المزامنة' : 'Sync failed';
  String get syncOffline => _ar ? 'غير متصل' : 'Offline';

  /// Display label for a stored genre value (internal value stays English).
  String genreLabel(String genre) {
    if (!_ar) return genre;
    return switch (genre) {
      'Action' => 'أكشن',
      'Adventure' => 'مغامرة',
      'Animation' => 'رسوم متحركة',
      'Comedy' => 'كوميديا',
      'Crime' => 'جريمة',
      'Documentary' => 'وثائقي',
      'Drama' => 'دراما',
      'Family' => 'عائلي',
      'Fantasy' => 'فانتازيا',
      'Historical' => 'تاريخي',
      'Horror' => 'رعب',
      'Mystery' => 'غموض',
      'Romance' => 'رومانسي',
      'Science Fiction' => 'خيال علمي',
      'Sports' => 'رياضة',
      'Thriller' => 'إثارة',
      'War' => 'حرب',
      'Western' => 'غربي',
      _ => genre,
    };
  }

  String themeName(AppThemeId id) => switch (id) {
        AppThemeId.dark => _ar ? 'داكن' : 'Dark',
        AppThemeId.light => _ar ? 'فاتح' : 'Light',
        AppThemeId.purple => _ar ? 'بنفسجي' : 'Purple',
        AppThemeId.brown => _ar ? 'بني' : 'Brown',
        AppThemeId.pink => _ar ? 'وردي' : 'Pink',
      };

  String get emptyListTitle => _ar ? 'قائمتك فارغة' : 'Your list is empty';
  String get emptyListBody => _ar
      ? 'اضغط + لإضافة أول عنوان إلى قائمتك.'
      : 'Tap + to add your first title to the list.';

  String get addTitle => _ar ? 'إضافة عنوان' : 'Add title';
  String get addTabSearch => _ar ? 'بحث' : 'Search';
  String get addTabManual => _ar ? 'يدوي' : 'Manual';
  String get addTabBulk => _ar ? 'عناوين متعددة' : 'Multiple titles';
  String get btnCopyTemplate =>
      _ar ? 'نسخ القالب للذكاء الاصطناعي' : 'Copy template for AI';
  String get btnAddAllTitles => _ar ? 'إضافة كل العناوين' : 'Add all titles';
  String get bulkHeadline => _ar
      ? 'أضف عدة عناوين دفعة واحدة بالذكاء الاصطناعي'
      : 'Add many titles at once with your AI';
  String get bulkStep1Title => _ar ? 'انسخ قالبنا' : 'Copy our template';
  String get bulkStep1Text => _ar
      ? 'اضغط الزر أدناه. يخبر الذكاء الاصطناعي بالضبط ما المعلومات المطلوبة لكل عنوان.'
      : 'Tap the button below. It tells your AI exactly what info to fill in for each title.';
  String get bulkStep2Title =>
      _ar ? 'أرسله للذكاء الاصطناعي' : 'Send it to your AI';
  String get bulkStep2Text => _ar
      ? 'الصق القالب في ChatGPT أو Claude أو أي ذكاء اصطناعي. ثم أضف عناوينك، مثلاً:'
      : 'Paste the template into ChatGPT, Claude, or any AI. Then add your titles, for example:';
  String get bulkExample => _ar
      ? '«إليك أفلامي: Breaking Bad، Interstellar، Attack on Titan…»'
      : '“Here are my movies: Breaking Bad, Interstellar, Attack on Titan…”';
  String get bulkStep3Title =>
      _ar ? 'الصق القائمة المعبأة' : 'Paste the filled list';
  String get bulkStep3Text => _ar
      ? 'انسخ ما يعيده الذكاء الاصطناعي والصقه هنا. سنضيف كل عنوان صالح دفعة واحدة.'
      : 'Copy what your AI returns and paste it here. We\'ll add every valid title at once.';
  String get bulkPastePlaceholder => _ar ? 'الصق هنا…' : 'Paste here…';
  String get bulkReadFailed =>
      _ar ? 'تعذر قراءة ما لصقته.' : 'Could not read that paste.';
  String get bulkAllDuplicates => _ar
      ? 'كل العناوين موجودة في قائمتك بالفعل.'
      : 'Every title was already on your list.';
  String get bulkNoneAdded =>
      _ar ? 'لم يُضف أي عنوان.' : 'No titles could be added.';
  String bulkDuplicatesSkipped(int count) =>
      _ar ? 'تم تخطي $count مكرر.' : '$count duplicate skipped.';
  String bulkDuplicatesSkippedPlural(int count) =>
      _ar ? 'تم تخطي $count عنوان مكرر.' : '$count duplicates skipped.';
  String get bulkTemplateCopiedTitle => _ar ? 'تم النسخ' : 'Copied';
  String get bulkTemplateCopied => _ar
      ? 'تم نسخ القالب. الصقه في ChatGPT أو Claude أو أي ذكاء اصطناعي.'
      : 'Template copied. Paste it into ChatGPT, Claude, or any AI.';
  String get bulkCopyFailedTitle => _ar ? 'فشل النسخ' : 'Copy failed';
  String get bulkCopyFailed => _ar
      ? 'تعذر النسخ. حدّد النص يدوياً.'
      : 'Could not copy. Select the text manually.';
  String get bulkAddedTitle => _ar ? 'تمت إضافة العناوين' : 'Titles added';
  String bulkAddedOne(String extra) => _ar
      ? 'تمت إضافة عنوان واحد لقائمتك.$extra'
      : 'Added 1 title to your list.$extra';
  String bulkAddedMany(int added, String extra) => _ar
      ? 'تمت إضافة $added عناوين لقائمتك.$extra'
      : 'Added $added titles to your list.$extra';
  String get titleSearchPlaceholder =>
      _ar ? 'مثال: Avengers، Demon Slayer…' : 'e.g. Avengers, Demon Slayer…';
  String get titleSearchType => _ar ? 'النوع' : 'Type';
  String get titleSearchTypeAll => _ar ? 'الكل' : 'All';
  String get searchConfirmTitle => _ar ? 'تأكيد العنوان' : 'Confirm title';
  String get searchBack => _ar ? 'العودة للبحث' : 'Back to search';
  String get fieldType => _ar ? 'النوع' : 'Type';
  String get fieldSecondaryGenres =>
      _ar ? 'تصنيفات ثانوية' : 'Secondary genres';
  String get fieldAddSecondaryGenre =>
      _ar ? 'أضف تصنيفاً آخر…' : 'Add another genre…';
  String searchFoundMany(int count) =>
      _ar ? 'وُجد $count نتيجة' : 'Found $count matches';
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
  String get manualLinkHint => _ar
      ? 'الصق رابط IMDb أو AniList أو MyAnimeList — سنملأ التفاصيل تلقائياً.'
      : 'Paste an IMDb, AniList, or MyAnimeList link — we\'ll fill in the details.';
  String get manualLinkPlaceholder => _ar
      ? 'https://www.imdb.com/title/… أو anilist.co/anime/…'
      : 'https://www.imdb.com/title/…, anilist.co/anime/…, or myanimelist.net/anime/…';
  String get manualLookingUp =>
      _ar ? 'جاري البحث عن الرابط…' : 'Looking up link…';
  String get manualFilled => _ar
      ? 'راجع قبل الحفظ — ملأنا النموذج من الرابط. تحقق من النوع والنوع الفرعي والعنوان والملخص.'
      : 'Review before you save — we filled the form from your link. Check type, genre, title, and summary.';
  String get manualNeedKey => _ar
      ? 'أضف مفتاح OMDb أو TMDb لروابط IMDb. روابط AniList تعمل بدون مفتاح.'
      : 'Add an OMDb or TMDb key for IMDb links. AniList links work without a key.';
  String get manualAnimeFail => _ar
      ? 'تعذر قراءة رابط الأنمي. تحقق من الرابط وحاول مرة أخرى.'
      : 'Couldn\'t read that anime link. Check the URL and try again.';
  String get manualLinkFail => _ar
      ? 'تعذر قراءة الرابط. تحقق من الرابط وحاول مرة أخرى.'
      : 'Couldn\'t read that link. Check the URL and try again.';
  String get searchNoSummary => _ar ? 'لا يوجد ملخص.' : 'No summary available.';
  String get linkPreviewLoading =>
      _ar ? 'جاري تحميل المعاينة…' : 'Loading preview…';
  String get fieldWatched => _ar ? 'مشاهَد' : 'Watched';
  String get fieldRating => _ar ? 'تقييمك (0–10)' : 'Your rating (0–10)';
  String get fieldWatchNote => _ar ? 'ملاحظة (اختياري)' : 'Note (optional)';
  String get deleteTitleTitle => _ar ? 'حذف العنوان' : 'Delete title';
  String deleteTitleConfirm(String name) =>
      _ar ? 'حذف «$name» من قائمتك؟' : 'Delete “$name” from your list?';
  String get emptyFilter =>
      _ar ? 'لا توجد عناوين في هذا التصنيف.' : 'No titles in this category.';

  String get searchPlaceholder =>
      _ar ? 'ابحث في العناوين أو أسماء الممثلين…' : 'Search titles or actors…';
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
  String backfillYearProgress(int done, int total) => _ar
      ? 'جاري تحميل سنوات الإصدار… $done/$total'
      : 'Loading release years… $done/$total';
  String backfillAnilistProgress(int done, int total) => _ar
      ? 'جاري تحميل تقييمات AniList… $done/$total'
      : 'Loading AniList scores… $done/$total';
  String backfillImdbProgress(int done, int total) => _ar
      ? 'جاري تحميل تقييمات IMDb… $done/$total'
      : 'Loading IMDb ratings… $done/$total';
  String get emptyRatingLoading => _ar
      ? 'جاري تحميل التقييمات من IMDb لقائمتك…'
      : 'Loading ratings from IMDb for your list…';
  String get emptyRatingMissing => _ar
      ? 'تقييمات IMDb غير محفوظة بعد. تُحمّل تلقائياً — انتظر قليلاً أو أضف عبر البحث.'
      : 'IMDb ratings are not saved yet. They load automatically — give it a moment, or add titles via search.';
  String get emptyRatingNeedConfig => _ar
      ? 'تقييمات IMDb تحتاج مفتاح OMDb أو TMDB.'
      : 'IMDb ratings need an OMDb or TMDB API key.';
  String get emptyAnilistRatingLoading => _ar
      ? 'جاري تحميل تقييمات AniList لعناوينك…'
      : 'Loading AniList scores for your titles…';
  String get emptyAnilistRatingMissing => _ar
      ? 'تقييمات AniList غير محفوظة بعد. تُحمّل تلقائياً — انتظر قليلاً أو أضف عبر البحث.'
      : 'AniList scores are not saved yet. They load automatically — give it a moment, or add titles via search.';
  String get emptyReleaseYearLoading => _ar
      ? 'جاري تحميل سنوات الإصدار لعناوينك…'
      : 'Loading release years for your titles…';
  String get emptyReleaseYearMissing => _ar
      ? 'سنوات الإصدار غير محفوظة بعد. تُحمّل تلقائياً من IMDb/AniList — انتظر قليلاً أو أضف عبر البحث.'
      : 'Release years are not saved yet. They load automatically from IMDb/AniList — give it a moment, or add titles via search.';
  String get emptyAgeRatingLoading => _ar
      ? 'جاري تحميل التصنيفات العمرية لعناوينك…'
      : 'Loading age ratings for your titles…';
  String get emptyAgeRatingMissing => _ar
      ? 'التصنيفات العمرية غير محفوظة بعد. تُحمّل تلقائياً من IMDb/AniList — انتظر قليلاً أو أضف عبر البحث.'
      : 'Age ratings are not saved yet. They load automatically from IMDb/AniList — give it a moment, or add titles via search.';
  String get emptyYearsNeedConfig => _ar
      ? 'سنوات الأفلام تحتاج مفتاح OMDb أو TMDB. سنوات الأنمي تُحمّل من AniList.'
      : 'Movie years need an OMDb or TMDB API key. Anime years still load from AniList.';

  String sortDirectionLabel(String sortSource, String sortDirection) {
    if (sortSource == 'added' || sortSource == 'release') {
      return sortDirection == 'oldest' ? sortOldestFirst : sortNewestFirst;
    }
    if (sortSource == 'imdb' ||
        sortSource == 'anilist' ||
        sortSource == 'personal' ||
        sortSource == 'age') {
      return sortDirection == 'worst' ? sortLowestFirst : sortHighestFirst;
    }
    return filterSortDirection;
  }

  String sortFilterLabel(String value) => switch (value) {
        'all' => _ar ? 'الترتيب الافتراضي' : 'Default order',
        'added' => _ar ? 'أُضيف مؤخراً' : 'Recently added',
        'release' => _ar ? 'تاريخ الإصدار' : 'Release date',
        'age' => _ar ? 'التصنيف العمري' : 'Age rating',
        'imdb' => _ar ? 'تقييمات IMDb' : 'IMDb ratings',
        'anilist' => _ar ? 'تقييمات AniList' : 'AniList ratings',
        'personal' => _ar ? 'تقييماتي' : 'My ratings',
        _ => value,
      };
  String get filterByGenre => _ar
      ? 'تصفية حسب التصنيف (أساسي أو ثانوي)'
      : 'Filter by genre (primary or secondary)';
  String get filterAllGenres => _ar ? 'كل التصنيفات' : 'All genres';
  String get filterLabelGenre => _ar ? 'التصنيف' : 'Genre';
  String get filterLabelWatched => _ar ? 'الحالة' : 'Status';
  String get filterLabelSort => _ar ? 'الترتيب' : 'Sort';
  String get filterAddGenre => filterAllGenres;
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
  String get shareSendDesc => _ar
      ? 'إنشاء رابط مشاركة لهذه القائمة'
      : 'Create a share link for this list';
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
        'expired' =>
          _ar ? 'انتهت صلاحية رابط المشاركة.' : 'This share link has expired.',
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
  String get importNewList => _ar ? 'فتح كقائمة جديدة' : 'Open as new list';
  String get importNewListFormTitle =>
      _ar ? 'سمّ قائمتك الجديدة' : 'Name your new list';
  String get importNewListFormHint => _ar
      ? 'ستُفتح القائمة المستوردة كقائمة جديدة دون تغيير قائمتك الحالية.'
      : 'The imported list will open as a new list without changing your current one.';
  String get importNewListSubmit => _ar ? 'إنشاء القائمة' : 'Create list';
  String get importNewListCreatedTitle =>
      _ar ? 'قائمة جديدة' : 'New list created';
  String importOpenedNewList(String name) => _ar
      ? 'فُتحت «$name» مع العناوين المستوردة.'
      : 'Opened “$name” with the imported titles.';
  String get importFromFile => _ar ? 'استيراد من ملف JSON' : 'Import JSON file';
  String get importCouldNotOpenFile => _ar
      ? 'تعذّر قراءة الملف. تأكد أنه نسخة احتياطية JSON صالحة من التطبيق.'
      : 'Could not read that file. Make sure it is a valid JSON backup from the app.';
  String get importCouldNotOpenFileTitle =>
      _ar ? 'تعذر فتح الملف' : 'Could not open file';

  String importMergedMessage({required int added, required int skipped}) {
    if (skipped > 0) {
      return _ar
          ? 'أُضيف $added عنواناً. تُرك $skipped مكرراً.'
          : 'Added $added titles. Skipped $skipped duplicates.';
    }
    return _ar
        ? 'أُضيفت العناوين إلى قائمتك.'
        : 'Titles were added to your list.';
  }

  String importMergedWithWatchMessage(
      {required int added, required int skipped}) {
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
        return _ar
            ? 'استخدم حرفاً واحداً على الأقل.'
            : 'Use at least one letter.';
      case 'auth.needNumber':
        return _ar
            ? 'استخدم رقماً واحداً على الأقل.'
            : 'Use at least one number.';
      case 'watchlist.duplicate':
        return _ar
            ? 'هذا العنوان موجود بالفعل في القائمة.'
            : 'This title is already on your list.';
      case 'watchlist.syncFailed':
        return _ar
            ? 'تم الحفظ محلياً لكن فشلت المزامنة السحابية.'
            : 'Saved locally, but cloud sync failed.';
      case 'watchlist.invalidRating':
        return _ar
            ? 'استخدم تقييماً بين 0 و10.'
            : 'Use a rating between 0 and 10.';
      case 'watchlist.notSignedIn':
        return _ar ? 'يرجى تسجيل الدخول.' : 'Please sign in.';
      case 'watchlist.notLoaded':
        return _ar ? 'القائمة غير جاهزة بعد.' : 'Watchlist is not ready yet.';
      case 'watchlist.notFound':
        return _ar ? 'تعذّر العثور على العنوان.' : 'Could not find that title.';
      case 'move.titleNotFound':
        return moveTitleNotFound;
      case 'move.alreadyOnThisList':
        return moveAlreadyOnThisList;
      case 'share.needsCloud':
        return shareArrivalError('share.needsCloud');
      case 'share.publishFailed':
        return sharePublishFailed;
      case 'share.localhost':
        return shareLocalhost;
      case 'import.empty':
        return shareArrivalError('empty');
      case 'import.failed':
        return _ar
            ? 'تعذّر إنشاء القائمة الجديدة.'
            : 'Could not create the new list.';
      case 'changeCode.codesMismatch':
        return _ar ? 'الرموز غير متطابقة.' : 'Codes do not match.';
      case 'changeCode.codeInUse':
        return _ar
            ? 'هذا الرمز مستخدم بالفعل. اختر رمزاً آخر.'
            : 'That code is already in use. Pick another.';
      case 'changeCode.cloudFailed':
        return _ar
            ? 'تعذر تحديث الحساب في السحابة. حاول مرة أخرى.'
            : 'Could not update cloud account. Try again.';
      case 'changeCode.sameCode':
        return _ar ? 'اختر رمزاً مختلفاً.' : 'Choose a different code.';
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
        return _ar ? 'بيانات العنوان ناقصة.' : 'Title details are incomplete.';
      case 'search.missingActors':
        return _ar
            ? 'لا يوجد ممثل أو طاقم — أضف العنوان يدوياً.'
            : 'No cast found — add the title manually instead.';
      case 'manual.needKey':
        return manualNeedKey;
      case 'manual.animeFail':
        return manualAnimeFail;
      case 'manual.linkFail':
        return manualLinkFail;
      case 'bulk.noneAdded':
        return bulkNoneAdded;
      default:
        return key;
    }
  }
}

final l10nProvider = Provider<L10n>((ref) {
  final locale = ref.watch(localeProvider);
  return L10n(locale.languageCode);
});
