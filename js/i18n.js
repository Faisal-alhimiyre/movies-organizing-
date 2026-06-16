(function () {
  "use strict";

  const STORAGE_KEY = "watchlist-lang-v1";
  const SUPPORTED = ["en", "ar"];
  let listeners = [];

  const MESSAGES = {
    en: {
      "app.title": "Our Movie Nights",
      "app.description":
        "Personal watchlist of movies, TV series, and anime organized by genre.",
      "btn.addTitle": "Add title",
      "btn.cancel": "Cancel",
      "btn.save": "Save",
      "btn.saving": "Saving…",
      "btn.adding": "Adding…",
      "btn.close": "Close",
      "btn.delete": "Delete",
      "btn.ok": "OK",
      "btn.confirm": "Confirm",
      "btn.createList": "Create list",
      "btn.updateCode": "Update code",
      "btn.addAllTitles": "Add all titles",
      "btn.addToList": "Add to list",
      "btn.rateLater": "Rate later",
      "btn.saveRating": "Save rating",
      "btn.loadMore": "Load more",
      "btn.copyTemplate": "Copy template for AI",
      "menu.label": "Menu",
      "menu.switchList": "Switch list",
      "menu.manageLists": "Manage lists",
      "menu.share": "Share",
      "menu.changeCode": "Change code",
      "menu.deleteAccount": "Delete account",
      "menu.signOut": "Sign out",
      "menu.language": "Language",
      "menu.theme": "Theme",
      "menu.about": "About",
      "theme.dark": "Dark",
      "theme.light": "Light",
      "theme.purple": "Purple",
      "theme.brown": "Brown",
      "theme.modalIntro": "Pick how the app looks. Your choice is saved on this device.",
      "theme.desc.midnight": "Warm dark default",
      "theme.desc.light": "Clean paper white",
      "theme.desc.purple": "Deep jewel tones",
      "theme.desc.brown": "Cocoa & beige",
      "lang.en": "English",
      "lang.ar": "العربية",
      "tab.all": "All",
      "tab.movies": "Movies",
      "tab.tvSeries": "TV Series",
      "tab.anime": "Anime",
      "filter.searchPlaceholder": "Search titles, actors, or summaries…",
      "filter.allGenres": "All genres",
      "filter.addGenre": "Add genre…",
      "filter.all": "All",
      "filter.watched": "Watched",
      "filter.unwatched": "Not watched",
      "filter.byGenre": "Filter by genre (primary or secondary)",
      "filter.byWatched": "Filter by watched status",
      "filter.byRating": "Sort by",
      "chip.removeFilter": "Remove {genre} filter",
      "chip.removeGenre": "Remove {genre}",
      "chip.removeLead": "Remove {name}",
      "chip.activeFilters": "Active genre filters",
      "filter.ratingOptionAll": "Default order",
      "filter.ratingOptionAddedNewest": "Recently added",
      "filter.ratingOptionAddedOldest": "Oldest first",
      "filter.ratingOptionImdbBest": "IMDb — highest first",
      "filter.ratingOptionImdbWorst": "IMDb — lowest first",
      "filter.ratingOptionAnilistBest": "AniList — highest first",
      "filter.ratingOptionAnilistWorst": "AniList — lowest first",
      "filter.ratingOptionPersonalBest": "My rating — highest first",
      "filter.ratingOptionPersonalWorst": "My rating — lowest first",
      "layout.hover": "Preview on hover",
      "layout.poster": "Show poster images",
      "layout.toolbar": "Card layout",
      "panel.contentType": "Content type",
      "panel.filters": "Filters and search",
      "loading.watchlist": "Loading watchlist…",
      "a11y.skipToMain": "Skip to main content",
      "footer.hint":
        "Your list is saved on this device. Use Menu → Share to send it to a friend or add theirs.",
      "preview.loading": "Loading preview…",
      "stats.total": "{total} total · {watched} watched{sync}",
      "stats.totalWord": "total",
      "stats.watchedWord": "watched",
      "sync.savingShort": "Saving…",
      "sync.failedShort": "Backup failed",
      "sync.savedShort": "Saved",
      "sync.offlineShort": "Offline",
      "sync.retry": "Retry",
      "sync.retryAria": "Retry backup",
      "sync.saving": " · saving…",
      "sync.failed": " · save failed",
      "sync.saved": " · saved",
      "empty.noTitles": "Your watchlist is empty",
      "empty.noTitlesHint":
        "Search for a title, add many at once with Multiple titles, or enter details manually.",
      "empty.firstTitle": "Add your first title",
      "empty.firstSubtitle": "Pick any way below — you can mix them anytime.",
      "empty.hintSearch": "Search add — find movies, TV, or anime by name",
      "empty.hintLink": "Manual add — paste an IMDb or AniList link",
      "empty.hintBulk": "Multiple titles — paste a list from ChatGPT or notes",
      "empty.ctaSearch": "Search for a title",
      "empty.ctaBulk": "Paste multiple titles",
      "empty.ctaImport": "Import a shared list",
      "empty.clearFilters": "Clear filters",
      "empty.noMatch": "No titles match your filters",
      "empty.noMatchHint": "Try a different search, genre, or type tab.",
      "empty.ratingLoading": "Loading ratings from IMDb for your list…",
      "empty.ratingMissing":
        "Ratings are not on your titles yet. They load automatically from IMDb links — give it a moment, or open the app again in a minute.",
      "empty.anilistRatingLoading": "Loading AniList scores for your anime…",
      "empty.anilistRatingMissing":
        "AniList scores are not saved yet. They load automatically for anime — give it a moment, or open the app again in a minute.",
      "ratings.backfillProgress": "Loading ratings… {done}/{total}",
      "ratings.backfillAnilist": "Loading AniList scores… {done}/{total}",
      "ratings.backfillImdb": "Loading IMDb ratings… {done}/{total}",
      "import.listDescription": "Imported {count} titles",
      "genre.oneTitle": "1 title",
      "genre.otherTitles": "{count} titles",
      "genre.allSelected": "All selected",
      "genreName.action": "Action",
      "genreName.adventure": "Adventure",
      "genreName.animation": "Animation",
      "genreName.comedy": "Comedy",
      "genreName.crime": "Crime",
      "genreName.documentary": "Documentary",
      "genreName.drama": "Drama",
      "genreName.family": "Family",
      "genreName.fantasy": "Fantasy",
      "genreName.historical": "Historical",
      "genreName.horror": "Horror",
      "genreName.mystery": "Mystery",
      "genreName.romance": "Romance",
      "genreName.scienceFiction": "Science Fiction",
      "genreName.sports": "Sports",
      "genreName.thriller": "Thriller",
      "genreName.war": "War",
      "genreName.western": "Western",
      "type.movie": "Movie",
      "type.movies": "Movies",
      "type.tvSeries": "TV Series",
      "type.anime": "Anime",
      "type.filmSeries": "Film series",
      "type.series": "TV Series",
      "card.notWatched": "Not watched",
      "card.notWatchedShort": "Unwatched",
      "card.watched": "Watched",
      "card.yourRating": "Your rating",
      "card.rate": "Rate",
      "card.markWatched": "Mark watched",
      "card.markUnwatched": "Mark unwatched",
      "card.markWatchedShort": "Mark watched",
      "card.markUnwatchedShort": "Unwatch",
      "card.edit": "Edit",
      "card.posterBroken":
        "Poster unavailable — the link may be broken. Tap Edit to replace the IMDb or AniList link, or delete this title and add it again via Search add.",
      "card.moveToList": "Move to another list",
      "card.moveToListShort": "Move list",
      "card.delete": "Delete",
      "card.actions": "Title actions",
      "card.openLink": "Open link",
      "search.type.all": "All",
      "search.type.movie": "Movies",
      "search.type.series": "TV Series",
      "search.type.anime": "Anime",
      "search.hint":
        "<strong>Can't find your title?</strong> Tap <strong>Manual</strong> at the top and add it yourself.",
      "search.label": "Search movies & shows",
      "search.placeholder": "e.g. Avengers, Demon Slayer…",
      "search.typeLabel": "Type",
      "search.minChars": "Type at least 2 characters to search.",
      "search.unavailable": "Search is not available right now.",
      "search.searching": "Searching…",
      "search.failed": "Search failed.",
      "search.noMatches": "No matches found. Try another spelling.",
      "search.showing": "Showing {shown} of {total} matches.",
      "search.foundOne": "1 match found.",
      "search.foundMany": "{count} matches found.",
      "search.loadingDetails": "Loading details…",
      "search.loadFailed": "Could not load that title. Try again.",
      "search.back": "Back to results",
      "search.chooseGenre": "Choose genre",
      "search.mainGenre": "Main genre",
      "search.noSummary": "No summary available.",
      "search.alreadyOnList": "On your list",
      "search.pickResult": "{title} — {meta}",
      "manual.hint":
        "<strong>Step 1: Paste your link.</strong> IMDb, AniList, or MyAnimeList. We'll fill in the details for you.",
      "manual.link": "Link",
      "manual.linkPlaceholder":
        "https://www.imdb.com/title/…, anilist.co/anime/…, or myanimelist.net/anime/…",
      "manual.lookingUp": "Looking up link…",
      "manual.filled":
        "<strong>Review before you save.</strong> We filled the form from your link. Check type, genre, title, and summary.",
      "manual.needKey":
        "Add an OMDb or TMDB key in config.js for IMDb links. AniList links work without a key.",
      "manual.animeFail": "Couldn't read that anime link. Check the URL and try again.",
      "manual.linkFail": "Couldn't read that link. Check the URL and try again.",
      "form.type": "Type",
      "form.mainGenre": "Main genre",
      "form.secondaryGenres": "Secondary genres",
      "form.addGenre": "Add another genre…",
      "form.title": "Title",
      "form.leads": "Lead actors",
      "form.actorPlaceholder": "Actor name",
      "form.add": "Add",
      "form.summary": "Summary",
      "modal.addTitle": "Add title",
      "modal.editTitle": "Edit title",
      "modal.close": "Close",
      "add.search": "Search",
      "add.manual": "Manual",
      "add.bulk": "Multiple titles",
      "add.mode": "Add mode",
      "changeCode.title": "Change list code",
      "changeCode.text":
        "Your movies stay the same. Only the sign-in code changes. 6+ characters, letters and numbers, no spaces. Capitals don't matter.",
      "changeCode.new": "New code",
      "changeCode.confirm": "Confirm new code",
      "changeCode.codesMismatch": "Codes do not match.",
      "changeCode.codeInUse": "That code is already in use. Pick another.",
      "changeCode.cloudFailed": "Could not update cloud account. Try again.",
      "share.title": "Share a list",
      "share.tagline": "Send a link — not your account code",
      "share.intro":
        "Sharing creates a link anyone can open. They log in with their own account and choose how to import your titles, ratings, and notes.",
      "share.note":
        "Your private login code is never included in a share link.",
      "share.sendTitle": "Send my list",
      "share.sendDesc": "Create a share link for this list",
      "share.importTitle": "Import a list",
      "share.importDesc": "Open a link someone sent you, or pick a .json backup file",
      "share.linkMessage": "My movie list “{name}” — open this link to import it into Our Movie Nights.",
      "share.arrivalTitle": "Shared list ready to import",
      "share.arrivalLoading": "Loading shared list…",
      "share.arrivalText": "“{name}” has {count} titles. Choose how to import it into your account.",
      "share.arrivalImport": "Review import",
      "share.arrivalDismiss": "Not now",
      "share.arrivalExpired": "This share link has expired.",
      "share.arrivalInvalid": "This share link is invalid or no longer available.",
      "onboarding.title": "Quick tips",
      "onboarding.code": "Your login code is private — use it only to open your account on your devices.",
      "onboarding.share": "To share a list, use Menu → Share and send the link. Never give anyone your code.",
      "onboarding.sync": "When you're online, your lists back up automatically — nothing to tap or check.",
      "onboarding.dismiss": "Got it",
      "about.pageTitle": "About — Our Movie Nights",
      "about.title": "Our Movie Nights",
      "about.tagline":
        "A free personal watchlist for movies, TV series, and anime — organized by genre, synced to the cloud, and shareable by link.",
      "about.whatTitle": "What you can do",
      "about.what1": "Build multiple lists per account",
      "about.what2": "Search, paste links, or bulk-add titles",
      "about.what3": "Mark watched, rate, and add private notes",
      "about.what4": "Share a list with a link — recipients import into their own account",
      "about.accountTitle": "Your account",
      "about.accountText":
        "You sign in with a private code you create. Keep it safe — we cannot recover a lost code. Your code is not used for sharing; share links are separate.",
      "about.attributionTitle": "Third-party data",
      "about.tmdbAttribution":
        'This product uses the <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB API</a> but is not endorsed or certified by TMDB.',
      "about.imdbAttribution":
        "Title metadata and posters may come from IMDb via the OMDb API. This product uses these sources for identification only and is not affiliated with IMDb.",
      "about.anilistAttribution":
        "Anime metadata may come from AniList. This product is not affiliated with AniList.",
      "about.supportTitle": "Support",
      "about.supportText": "Questions or feedback:",
      "about.supportFallback": "See project README",
      "about.backGate": "Log in",
      "about.openApp": "Open app",
      "share.fileMessage":
        "My watchlist backup. Open Our Movie Nights → Share → Import a list.",
      "manage.title": "Manage lists",
      "manage.create": "Create a new list",
      "manage.unnamedList": "Unnamed list",
      "manage.signedInNow": "Signed in now",
      "manage.switchToList": "Open list",
      "manage.editListName": "Edit \"{name}\"",
      "manage.deleteListName": "Delete \"{name}\"",
      "manage.switchListName": "Open \"{name}\"",
      "create.name": "Name",
      "create.namePlaceholder": "Classic movies",
      "create.about": "About this list",
      "create.aboutPlaceholder": "Old Hollywood picks for rainy nights",
      "create.newList": "New list",
      "create.editList": "Edit list",
      "move.title": "Move to another list",
      "move.text":
        'Duplicate "{title}" to another list. Current list stays unchanged.',
      "move.empty": "Create another list first.",
      "import.title": "Import a list",
      "import.hint":
        "Choose how to import. Opening as a new list keeps your current list unchanged.",
      "import.hintEmpty":
        "Open as a new list (recommended), or add these titles to your current list.",
      "import.summaryWithCurrent":
        '"{listName}" has {count} titles. You\'re on "{currentName}" with {currentCount}.',
      "import.summaryEmpty": '"{listName}" has {count} titles. Your current list is empty.',
      "import.newList": "Open as new list",
      "import.merge": "Add to my current list",
      "import.replace": "Replace my current list",
      "import.addToList": "Add to this list",
      "rating.title": "Rate title",
      "rating.rateItem": 'Rate "{title}"',
      "rating.yourScore": "Your rating (out of 10)",
      "rating.starsGroup": "Tap a star to rate out of 10",
      "rating.star": "{n} out of 10",
      "rating.lower": "Lower rating by 0.1",
      "rating.raise": "Raise rating by 0.1",
      "rating.fineTune": "Fine-tune",
      "rating.chooseStarFirst": "Tap a star to choose your score first.",
      "rating.note": "Note for yourself",
      "rating.notePlaceholder": "What stood out? Would you watch again?",
      "bulk.headline": "Add many titles at once with your AI",
      "bulk.step1Title": "Copy our template",
      "bulk.step1Text":
        "Click the button below. It tells your AI exactly what info to fill in for each title.",
      "bulk.step2Title": "Send it to your AI",
      "bulk.step2Text":
        "Paste the template into ChatGPT, Claude, or any AI. Then add your titles, for example:",
      "bulk.example":
        "“Here are my movies: Breaking Bad, Interstellar, Attack on Titan…”",
      "bulk.step3Title": "Paste the filled list",
      "bulk.step3Text":
        "Copy what your AI returns and paste it here. We'll add every valid title at once.",
      "bulk.pastePlaceholder": "Paste here…",
      "bulk.pasteLabel": "Paste filled list from AI",
      "bulk.readFailed": "Could not read that paste.",
      "bulk.allDuplicates": "Every title was already on your list.",
      "bulk.noneAdded": "No titles could be added.",
      "bulk.duplicatesSkipped": "{count} duplicate skipped.",
      "bulk.duplicatesSkippedPlural": "{count} duplicates skipped.",
      "error.cloudSyncFailed": "Saved locally, but cloud sync failed. Try again.",
      "error.loadWatchlistFailed": "Could not load watchlist data",
      "error.loadWatchlistHint": "Try signing out and back in, or clear site data for this page.",
      "dialog.notice": "Notice",
      "dialog.sure": "Are you sure?",
      "gate.title": "Our Movie Nights",
      "gate.openList": "Log in",
      "gate.newList": "Create new account",
      "gate.access": "Account access",
      "gate.codeSaveWarning":
        "Write your code down and keep it safe. If you lose it, we cannot recover your account or lists.",
      "gate.rulesLabel": "Code requirements",
      "gate.ruleLength": "6+ characters",
      "gate.ruleChars": "Letters and numbers",
      "gate.ruleSpaces": "No spaces",
      "gate.ruleCaps": "Capitalization doesn't matter",
      "gate.showCode": "Show code",
      "gate.hideCode": "Hide code",
      "gate.yourCode": "Your code",
      "gate.chooseCode": "Choose a code",
      "gate.confirmCode": "Confirm code",
      "gate.open": "Log in",
      "gate.createList": "Create account",
      "gate.noList":
        "No account found with this code. Use Create new account to sign up.",
      "gate.codesMismatch": "Codes do not match.",
      "gate.codeExists":
        "An account with this code already exists. Use Log in instead.",
      "gate.deleted":
        "Account deleted. You can create a new account with the same code.",
      "auth.spaces": "Spaces are not allowed.",
      "auth.minLength": "Use at least {n} characters.",
      "auth.needLetter": "Use at least one letter.",
      "auth.needNumber": "Use at least one number.",
      "auth.listNameRequired": "Give your list a name.",
      "auth.listNameLong": "Keep the name under 48 characters.",
      "mobile.notWatched": "Not watched yet",
      "mobile.watchedUnrated": "Watched — not rated yet",
      "mobile.rateTitle": "Rate this title",
      "mobile.editRating": "Edit rating",
      "mobile.close": "Close",
      "alert.genreRequired": "Choose a main genre before adding.",
      "alert.genreRequiredTitle": "Genre required",
      "alert.incomplete": "This title is missing a summary. Add it manually instead.",
      "alert.incompleteTitle": "Incomplete data",
      "alert.noLeads": "Add at least one lead actor before saving.",
      "alert.noLeadsTitle": "Lead actors required",
      "alert.duplicate": "This title is already in your list.",
      "alert.duplicateTitle": "Already added",
      "alert.leadRequired": "Add at least one lead actor.",
      "alert.leadRequiredTitle": "Lead actors",
      "alert.invalidLink": "Enter a valid link (IMDb, AniList, or MyAnimeList URL).",
      "alert.invalidLinkTitle": "Invalid link",
      "alert.nameExists": "A title with this name already exists in this type.",
      "alert.nameExistsTitle": "Duplicate title",
      "alert.missingActors":
        "No actors were found for this title. Add it manually instead.",
      "alert.missingActorsTitle": "Missing actors",
      "alert.duplicateOnList":
        "A title with this name already exists on your list.",
      "alert.codeUpdated":
        "Sign in with your new code from now on, and share it only with friends you trust.",
      "alert.codeUpdatedTitle": "Code updated",
      "alert.couldNotMoveTitle": "Could not move",
      "alert.titleCopied": "“{title}” was copied to {listName}.",
      "alert.titleCopiedTitle": "Copied to list",
      "alert.titleNotFound": "Title not found.",
      "alert.alreadyOnThisList": "That title is already on this list.",
      "alert.alreadyOnList": "“{title}” is already on {listName}.",
      "alert.deleteAccountConfirm":
        "Delete your account and all {lists}? Your sign-in code will be free to use again.",
      "alert.deleteAccountTitle": "Delete account?",
      "alert.partialDeleteAccount":
        "Removed from this device, but cloud delete failed. Try Delete account once more.",
      "alert.partialDeleteAccountTitle": "Partially deleted",
      "alert.deleteListConfirm":
        "Delete “{label}” ({titles})? Your account and other lists stay.",
      "alert.deleteListTitle": "Delete list?",
      "alert.partialDeleteList":
        "Removed from this device, but cloud delete failed. Try deleting again or check your connection.",
      "alert.partialDeleteListTitle": "Partially deleted",
      "alert.bulkTemplateCopied":
        "Template copied. Paste it into your AI, add your title list, then paste the filled JSON back here.",
      "alert.bulkTemplateCopiedTitle": "Copied",
      "alert.bulkCopyFailed":
        "Could not copy automatically. Select the template text from the AI instructions and copy manually.",
      "alert.bulkCopyFailedTitle": "Copy failed",
      "alert.bulkAddedOne": "Added 1 title to your list.{extra}",
      "alert.bulkAddedMany": "Added {added} titles to your list.{extra}",
      "alert.bulkAddedTitle": "Titles added",
      "alert.missingActorTitle": "Missing actor",
      "alert.deleteTitleConfirm":
        "Remove “{name}” from your watchlist? This cannot be undone.",
      "alert.deleteTitleTitle": "Delete title",
      "alert.importEmptyList": "That file or link has no titles to import.",
      "alert.importEmptyListTitle": "Nothing to import",
      "alert.importFailedTitle": "Import failed",
      "alert.couldNotCreateList": "Could not create a new list.",
      "alert.savedLocallyCloudFail":
        "Created locally, but cloud sync failed. Your new list is on this device.",
      "alert.savedLocally":
        "Saved on this device, but cloud sync failed. Your changes are still here locally.",
      "alert.cloudSyncFailed":
        "Your changes are on this device, but backup failed. Check your connection and tap Retry in the header.",
      "alert.cloudSyncFailedDelete":
        "Removed on this device, but backup didn't update. Tap Retry when you're back online.",
      "alert.savedLocallyTitle": "On this device only",
      "alert.listShared":
        "If the share finished, your friend can open the link, sign in, and import your list.",
      "alert.listSharedTitle": "List shared",
      "alert.listSharedLink":
        "Your friend can open the link, sign in or create a list, then choose how to import.",
      "alert.listSharedFile":
        "If the share finished, your friend can import the file from Share → Import a list.",
      "alert.linkCopied":
        "Link copied. Paste it in WhatsApp, email, or any chat app.",
      "alert.copyLinkManualTitle": "Copy this link",
      "alert.shareLinkFailed":
        "Could not create a share link. Sending a file instead.",
      "alert.shareLinkFailedTitle": "Link unavailable",
      "alert.shareLinkExpired": "This share link has expired. Ask your friend to send a new one.",
      "alert.shareLinkInvalid": "This share link is invalid or no longer available.",
      "alert.shareNeedsCloud": "Share links need cloud sync. Ask your friend to send a file instead.",
      "alert.shareLocalhost":
        "This link was created on your computer (localhost), so friends cannot open it. Open the app on your GitHub Pages site and share again, or set publicAppUrl in js/config.js to your live site URL.",
      "alert.shareLocalhostTitle": "Use your live site link",
      "alert.listReadyToSend":
        "Your list file was downloaded. Send it by WhatsApp, email, or any chat app. Your friend opens the app → Share → Import a list.",
      "alert.listReadyToSendTitle": "List ready to send",
      "alert.importOpenedNewList":
        "Opened “{name}” as a new list. Your previous list is unchanged.",
      "alert.importMerged": "New titles were added to your current list.",
      "alert.importMergedSkips": "{added} added. {skipped} duplicate titles were already on your list.",
      "alert.importReplaced": "Your current list was updated with the imported file.",
      "alert.newListCreatedTitle": "New list created",
      "alert.listUpdatedTitle": "List updated",
      "alert.couldNotOpenFile":
        "Could not read that file. Ask your friend to send one downloaded from this app.",
      "alert.couldNotOpenFileTitle": "Could not open file",
      "alert.importMergeConfirm":
        "Add {count} titles from “{listName}” to “{currentName}”? Duplicates will be skipped.",
      "alert.importMergeTitle": "Add to current list?",
      "alert.importReplaceConfirm":
        "Replace “{currentName}” with “{listName}” ({count} titles)? Your current list will be lost.",
      "alert.importAddConfirm":
        "Add {count} titles from “{listName}” to your list?",
      "alert.importReplaceTitle": "Replace current list?",
      "alert.importAddTitle": "Add to this list?",
      "btn.addTitles": "Add titles",
      "btn.replaceList": "Replace list",
      "alert.codeUpgrade":
        "Your old code (like 1234) no longer fits the new rules. Pick a new personal code with letters and numbers — at least 6 characters.",
      "alert.codeUpgradeTitle": "Update your sign-in code",
      "list.myList": "My list",
      "list.thisList": "This list",
      "list.sharedList": "Shared list",
      "list.importedList": "Imported list",
      "list.thisTitle": "this title",
      "plural.oneList": "1 list",
      "plural.otherLists": "{count} lists",
      "plural.oneTitle": "1 title",
      "plural.otherTitles": "{count} titles",
      "searchResult.movie": "Movie",
      "searchResult.series": "TV Series",
      "searchResult.anime": "Anime",
      "searchResult.episode": "Episode",
      "searchResult.title": "Title",
    },
    ar: {
      "app.title": "ليالينا السينمائية",
      "app.description":
        "قائمة مشاهدة شخصية للأفلام والمسلسلات والأنمي مرتبة حسب التصنيف.",
      "btn.addTitle": "إضافة عنوان",
      "btn.cancel": "إلغاء",
      "btn.save": "حفظ",
      "btn.saving": "جاري الحفظ…",
      "btn.adding": "جاري الإضافة…",
      "btn.close": "إغلاق",
      "btn.delete": "حذف",
      "btn.ok": "حسناً",
      "btn.confirm": "تأكيد",
      "btn.createList": "إنشاء قائمة",
      "btn.updateCode": "تحديث الرمز",
      "btn.addAllTitles": "إضافة كل العناوين",
      "btn.addToList": "إضافة للقائمة",
      "btn.rateLater": "التقييم لاحقاً",
      "btn.saveRating": "حفظ التقييم",
      "btn.loadMore": "عرض المزيد",
      "btn.copyTemplate": "نسخ القالب للذكاء الاصطناعي",
      "menu.label": "القائمة",
      "menu.switchList": "تبديل القائمة",
      "menu.manageLists": "إدارة القوائم",
      "menu.share": "مشاركة",
      "menu.changeCode": "تغيير الرمز",
      "menu.deleteAccount": "حذف الحساب",
      "menu.signOut": "تسجيل الخروج",
      "menu.language": "اللغة",
      "menu.theme": "المظهر",
      "menu.about": "حول التطبيق",
      "theme.dark": "داكن",
      "theme.light": "فاتح",
      "theme.purple": "بنفسجي",
      "theme.brown": "بني",
      "theme.modalIntro": "اختر شكل التطبيق. يُحفظ اختيارك على هذا الجهاز.",
      "theme.desc.midnight": "داكن دافئ افتراضي",
      "theme.desc.light": "أبيض نظيف",
      "theme.desc.purple": "ألوان عميقة زاهية",
      "theme.desc.brown": "كاكاو وبيج",
      "lang.en": "English",
      "lang.ar": "العربية",
      "tab.all": "الكل",
      "tab.movies": "أفلام",
      "tab.tvSeries": "مسلسلات",
      "tab.anime": "أنمي",
      "filter.searchPlaceholder": "ابحث في العناوين أو الممثلين أو الملخصات…",
      "filter.allGenres": "كل التصنيفات",
      "filter.addGenre": "أضف تصنيفاً…",
      "filter.all": "الكل",
      "filter.watched": "تمت المشاهدة",
      "filter.unwatched": "لم تُشاهد",
      "filter.byGenre": "تصفية حسب التصنيف (رئيسي أو ثانوي)",
      "filter.byWatched": "تصفية حسب حالة المشاهدة",
      "filter.byRating": "ترتيب حسب",
      "chip.removeFilter": "إزالة تصنيف {genre}",
      "chip.removeGenre": "إزالة {genre}",
      "chip.removeLead": "إزالة {name}",
      "chip.activeFilters": "تصنيفات التصفية النشطة",
      "filter.ratingOptionAll": "الترتيب الافتراضي",
      "filter.ratingOptionAddedNewest": "المضاف مؤخراً",
      "filter.ratingOptionAddedOldest": "الأقدم أولاً",
      "filter.ratingOptionImdbBest": "IMDb — الأعلى أولاً",
      "filter.ratingOptionImdbWorst": "IMDb — الأقل أولاً",
      "filter.ratingOptionAnilistBest": "AniList — الأعلى أولاً",
      "filter.ratingOptionAnilistWorst": "AniList — الأقل أولاً",
      "filter.ratingOptionPersonalBest": "تقييمي — الأعلى أولاً",
      "filter.ratingOptionPersonalWorst": "تقييمي — الأقل أولاً",
      "layout.hover": "معاينة عند التمرير",
      "layout.poster": "عرض صور الغلاف",
      "layout.toolbar": "شكل البطاقات",
      "panel.contentType": "نوع المحتوى",
      "panel.filters": "التصفية والبحث",
      "loading.watchlist": "جاري تحميل القائمة…",
      "a11y.skipToMain": "تخطي إلى المحتوى الرئيسي",
      "footer.hint":
        "قائمتك محفوظة على هذا الجهاز. من القائمة → مشاركة لإرسالها لصديق أو إضافة قائمته.",
      "preview.loading": "جاري تحميل المعاينة…",
      "stats.total": "{total} إجمالي · {watched} تمت مشاهدتها{sync}",
      "stats.totalWord": "إجمالي",
      "stats.watchedWord": "تمت مشاهدتها",
      "sync.savingShort": "جاري الحفظ…",
      "sync.failedShort": "فشل النسخ الاحتياطي",
      "sync.savedShort": "تم الحفظ",
      "sync.offlineShort": "غير متصل",
      "sync.retry": "إعادة المحاولة",
      "sync.retryAria": "إعادة محاولة النسخ الاحتياطي",
      "sync.saving": " · جاري الحفظ…",
      "sync.failed": " · فشل الحفظ",
      "sync.saved": " · تم الحفظ",
      "empty.noTitles": "قائمتك فارغة",
      "empty.noTitlesHint":
        "ابحث عن عنوان، أو أضف عدة عناوين دفعة واحدة، أو أدخل التفاصيل يدوياً.",
      "empty.firstTitle": "أضف عنوانك الأول",
      "empty.firstSubtitle": "اختر أي طريقة — يمكنك الجمع بينها في أي وقت.",
      "empty.hintSearch": "إضافة بالبحث — ابحث عن أفلام أو مسلسلات أو أنمي بالاسم",
      "empty.hintLink": "إضافة يدوية — الصق رابط IMDb أو AniList",
      "empty.hintBulk": "عناوين متعددة — الصق قائمة من ChatGPT أو ملاحظاتك",
      "empty.ctaSearch": "ابحث عن عنوان",
      "empty.ctaBulk": "الصق عدة عناوين",
      "empty.ctaImport": "استيراد قائمة مشتركة",
      "empty.clearFilters": "مسح التصفية",
      "empty.noMatch": "لا توجد عناوين تطابق التصفية",
      "empty.noMatchHint": "جرّب بحثاً أو تصنيفاً أو تبويباً مختلفاً.",
      "empty.ratingLoading": "جاري تحميل التقييمات من IMDb لقائمتك…",
      "empty.ratingMissing":
        "التقييمات غير محفوظة على عناوينك بعد. تُحمّل تلقائياً من روابط IMDb — انتظر قليلاً أو أعد فتح التطبيق بعد دقيقة.",
      "empty.anilistRatingLoading": "جاري تحميل تقييمات AniList للأنمي…",
      "empty.anilistRatingMissing":
        "تقييمات AniList غير محفوظة بعد. تُحمّل تلقائياً للأنمي — انتظر قليلاً أو أعد فتح التطبيق بعد دقيقة.",
      "ratings.backfillProgress": "جاري تحميل التقييمات… {done}/{total}",
      "ratings.backfillAnilist": "جاري تحميل تقييمات AniList… {done}/{total}",
      "ratings.backfillImdb": "جاري تحميل تقييمات IMDb… {done}/{total}",
      "import.listDescription": "تم استيراد {count} عنواناً",
      "genre.oneTitle": "عنوان واحد",
      "genre.otherTitles": "{count} عناوين",
      "genre.allSelected": "كل المحدد",
      "genreName.action": "أكشن",
      "genreName.adventure": "مغامرة",
      "genreName.animation": "رسوم متحركة",
      "genreName.comedy": "كوميديا",
      "genreName.crime": "جريمة",
      "genreName.documentary": "وثائقي",
      "genreName.drama": "دراما",
      "genreName.family": "عائلي",
      "genreName.fantasy": "خيال",
      "genreName.historical": "تاريخي",
      "genreName.horror": "رعب",
      "genreName.mystery": "غموض",
      "genreName.romance": "رومانسي",
      "genreName.scienceFiction": "خيال علمي",
      "genreName.sports": "رياضة",
      "genreName.thriller": "إثارة",
      "genreName.war": "حرب",
      "genreName.western": "غربي",
      "type.movie": "فيلم",
      "type.movies": "أفلام",
      "type.tvSeries": "مسلسل",
      "type.anime": "أنمي",
      "type.filmSeries": "سلسلة أفلام",
      "type.series": "مسلسل",
      "card.notWatched": "لم تُشاهد",
      "card.notWatchedShort": "غير مشاهد",
      "card.watched": "مشاهد",
      "card.yourRating": "تقييمك",
      "card.rate": "قيّم",
      "card.markWatched": "تعيين كمشاهد",
      "card.markUnwatched": "تعيين كغير مشاهد",
      "card.markWatchedShort": "مشاهد",
      "card.markUnwatchedShort": "إلغاء",
      "card.edit": "تعديل",
      "card.posterBroken":
        "الغلاف غير متاح — قد يكون الرابط معطلاً. اضغط تعديل لاستبدال رابط IMDb أو AniList، أو احذف العنوان وأضفه مجدداً عبر البحث.",
      "card.moveToList": "نقل لقائمة أخرى",
      "card.moveToListShort": "نقل",
      "card.delete": "حذف",
      "card.actions": "إجراءات العنوان",
      "card.openLink": "فتح الرابط",
      "search.type.all": "الكل",
      "search.type.movie": "أفلام",
      "search.type.series": "مسلسلات",
      "search.type.anime": "أنمي",
      "search.hint":
        "<strong>لم تجد عنوانك؟</strong> اضغط <strong>يدوي</strong> في الأعلى وأضفه بنفسك.",
      "search.label": "ابحث عن أفلام ومسلسلات",
      "search.placeholder": "مثال: Avengers، Demon Slayer…",
      "search.typeLabel": "النوع",
      "search.minChars": "اكتب حرفين على الأقل للبحث.",
      "search.unavailable": "البحث غير متاح حالياً.",
      "search.searching": "جاري البحث…",
      "search.failed": "فشل البحث.",
      "search.noMatches": "لا توجد نتائج. جرّب كتابة مختلفة.",
      "search.showing": "عرض {shown} من {total} نتيجة.",
      "search.foundOne": "نتيجة واحدة.",
      "search.foundMany": "{count} نتائج.",
      "search.loadingDetails": "جاري تحميل التفاصيل…",
      "search.loadFailed": "تعذر تحميل هذا العنوان. حاول مرة أخرى.",
      "search.back": "العودة للنتائج",
      "search.chooseGenre": "اختر التصنيف",
      "search.mainGenre": "التصنيف الرئيسي",
      "search.noSummary": "لا يوجد ملخص.",
      "search.alreadyOnList": "في قائمتك",
      "search.pickResult": "{title} — {meta}",
      "manual.hint":
        "<strong>الخطوة 1: الصق الرابط.</strong> IMDb أو AniList أو MyAnimeList. سنملأ التفاصيل لك.",
      "manual.link": "الرابط",
      "manual.linkPlaceholder":
        "https://www.imdb.com/title/… أو anilist.co/anime/… أو myanimelist.net/anime/…",
      "manual.lookingUp": "جاري البحث عن الرابط…",
      "manual.filled":
        "<strong>راجع قبل الحفظ.</strong> ملأنا النموذج من رابطك. تحقق من النوع والتصنيف والعنوان والملخص.",
      "manual.needKey":
        "أضف مفتاح OMDb أو TMDB في config.js لروابط IMDb. روابط AniList تعمل بدون مفتاح.",
      "manual.animeFail": "تعذر قراءة رابط الأنمي. تحقق من الرابط وحاول مرة أخرى.",
      "manual.linkFail": "تعذر قراءة الرابط. تحقق من الرابط وحاول مرة أخرى.",
      "form.type": "النوع",
      "form.mainGenre": "التصنيف الرئيسي",
      "form.secondaryGenres": "تصنيفات ثانوية",
      "form.addGenre": "أضف تصنيفاً آخر…",
      "form.title": "العنوان",
      "form.leads": "الممثلون الرئيسيون",
      "form.actorPlaceholder": "اسم الممثل",
      "form.add": "إضافة",
      "form.summary": "الملخص",
      "modal.addTitle": "إضافة عنوان",
      "modal.editTitle": "تعديل العنوان",
      "modal.close": "إغلاق",
      "add.search": "بحث",
      "add.manual": "يدوي",
      "add.bulk": "عناوين متعددة",
      "add.mode": "طريقة الإضافة",
      "changeCode.title": "تغيير رمز القائمة",
      "changeCode.text":
        "أفلامك تبقى كما هي. يتغير رمز الدخول فقط. 6 أحرف أو أكثر، حروف وأرقام، بدون مسافات. الأحرف الكبيرة لا تهم.",
      "changeCode.new": "الرمز الجديد",
      "changeCode.confirm": "تأكيد الرمز الجديد",
      "changeCode.codesMismatch": "الرموز غير متطابقة.",
      "changeCode.codeInUse": "هذا الرمز مستخدم بالفعل. اختر رمزاً آخر.",
      "changeCode.cloudFailed": "تعذر تحديث الحساب في السحابة. حاول مرة أخرى.",
      "share.title": "مشاركة قائمة",
      "share.tagline": "أرسل رابطاً — وليس رمز حسابك",
      "share.intro":
        "المشاركة تنشئ رابطاً يمكن لأي شخص فتحه. يسجل الدخول بحسابه ويختار كيفية استيراد العناوين والتقييمات والملاحظات.",
      "share.note": "رمز الدخول الخاص بك لا يُرسل أبداً في رابط المشاركة.",
      "share.sendTitle": "إرسال قائمتي",
      "share.sendDesc": "إنشاء رابط مشاركة لهذه القائمة",
      "share.importTitle": "استيراد قائمة",
      "share.importDesc": "افتح رابطاً أرسله لك أحدهم، أو اختر ملف نسخ احتياطي .json",
      "share.linkMessage": "قائمتي «{name}» — افتح هذا الرابط لاستيرادها في Our Movie Nights.",
      "share.arrivalTitle": "قائمة مشتركة جاهزة للاستيراد",
      "share.arrivalLoading": "جاري تحميل القائمة المشتركة…",
      "share.arrivalText": "«{name}» تحتوي على {count} عنواناً. اختر كيف تستوردها إلى حسابك.",
      "share.arrivalImport": "مراجعة الاستيراد",
      "share.arrivalDismiss": "ليس الآن",
      "share.arrivalExpired": "انتهت صلاحية رابط المشاركة.",
      "share.arrivalInvalid": "رابط المشاركة غير صالح أو لم يعد متاحاً.",
      "onboarding.title": "نصائح سريعة",
      "onboarding.code": "رمز الدخول خاص بك — استخدمه فقط لفتح حسابك على أجهزتك.",
      "onboarding.share": "لمشاركة قائمة، استخدم القائمة → مشاركة وأرسل الرابط. لا تعطِ أحداً رمزك.",
      "onboarding.sync": "عند اتصالك بالإنترنت، تُنسخ قوائمك تلقائياً — لا حاجة لأي إجراء منك.",
      "onboarding.dismiss": "فهمت",
      "about.pageTitle": "حول — ليالينا السينمائية",
      "about.title": "ليالينا السينمائية",
      "about.tagline":
        "قائمة مشاهدة شخصية مجانية للأفلام والمسلسلات والأنمي — مرتبة حسب التصنيف، متزامنة مع السحابة، وقابلة للمشاركة برابط.",
      "about.whatTitle": "ماذا يمكنك أن تفعل",
      "about.what1": "إنشاء عدة قوائم لكل حساب",
      "about.what2": "البحث أو لصق الروابط أو إضافة عناوين دفعة واحدة",
      "about.what3": "تعليم المشاهدة والتقييم وملاحظات خاصة",
      "about.what4": "مشاركة قائمة برابط — المستلم يستوردها إلى حسابه",
      "about.accountTitle": "حسابك",
      "about.accountText":
        "تسجّل الدخول برمز خاص تنشئه أنت. احتفظ به بأمان — لا يمكننا استعادة رمز مفقود. الرمز لا يُستخدم للمشاركة؛ روابط المشاركة منفصلة.",
      "about.attributionTitle": "بيانات طرف ثالث",
      "about.tmdbAttribution":
        'يستخدم هذا المنتج <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">واجهة TMDB</a> دون اعتماد أو تصديق من TMDB.',
      "about.imdbAttribution":
        "قد تأتي بيانات العناوين والأغلفة من IMDb عبر OMDb. يُستخدم المصدر للتعريف فقط وليس هناك ارتباط بـ IMDb.",
      "about.anilistAttribution":
        "قد تأتي بيانات الأنمي من AniList. هذا المنتج غير تابع لـ AniList.",
      "about.supportTitle": "الدعم",
      "about.supportText": "أسئلة أو ملاحظات:",
      "about.supportFallback": "راجع README للمشروع",
      "about.backGate": "تسجيل الدخول",
      "about.openApp": "فتح التطبيق",
      "share.fileMessage":
        "نسخة احتياطية من قائمتي. افتح Our Movie Nights ← مشاركة ← استيراد قائمة.",
      "manage.title": "إدارة القوائم",
      "manage.create": "إنشاء قائمة جديدة",
      "manage.unnamedList": "قائمة بدون اسم",
      "manage.signedInNow": "مسجل الدخول الآن",
      "manage.switchToList": "فتح القائمة",
      "manage.editListName": "تعديل «{name}»",
      "manage.deleteListName": "حذف «{name}»",
      "manage.switchListName": "فتح «{name}»",
      "create.name": "الاسم",
      "create.namePlaceholder": "أفلام كلاسيكية",
      "create.about": "عن هذه القائمة",
      "create.aboutPlaceholder": "اختيارات هوليوود القديمة لليالي الممطرة",
      "create.newList": "قائمة جديدة",
      "create.editList": "تعديل القائمة",
      "move.title": "نقل لقائمة أخرى",
      "move.text": 'تكرار "{title}" في قائمة أخرى. القائمة الحالية تبقى كما هي.',
      "move.empty": "أنشئ قائمة أخرى أولاً.",
      "import.title": "استيراد قائمة",
      "import.hint":
        "اختر طريقة الاستيراد. الفتح كقائمة جديدة يبقي قائمتك الحالية دون تغيير.",
      "import.hintEmpty":
        "افتح كقائمة جديدة (موصى به)، أو أضف هذه العناوين لقائمتك الحالية.",
      "import.summaryWithCurrent":
        '«{listName}» فيها {count} عنواناً. أنت على «{currentName}» بـ {currentCount}.',
      "import.summaryEmpty": '«{listName}» فيها {count} عنواناً. قائمتك الحالية فارغة.',
      "import.newList": "فتح كقائمة جديدة",
      "import.merge": "إضافة لقائمتي الحالية",
      "import.replace": "استبدال قائمتي الحالية",
      "import.addToList": "إضافة لهذه القائمة",
      "rating.title": "تقييم العنوان",
      "rating.rateItem": 'تقييم "{title}"',
      "rating.yourScore": "تقييمك (من 10)",
      "rating.starsGroup": "اضغط نجمة للتقييم من 10",
      "rating.star": "{n} من 10",
      "rating.lower": "خفض التقييم 0.1",
      "rating.raise": "رفع التقييم 0.1",
      "rating.fineTune": "ضبط دقيق",
      "rating.chooseStarFirst": "اضغط نجمة لاختيار التقييم أولاً.",
      "rating.note": "ملاحظة لنفسك",
      "rating.notePlaceholder": "ما الذي لفت انتباهك؟ هل ستشاهده مرة أخرى؟",
      "bulk.headline": "أضف عدة عناوين دفعة واحدة بالذكاء الاصطناعي",
      "bulk.step1Title": "انسخ قالبنا",
      "bulk.step1Text":
        "اضغط الزر أدناه. يخبر الذكاء الاصطناعي بالضبط ما المعلومات المطلوبة لكل عنوان.",
      "bulk.step2Title": "أرسله للذكاء الاصطناعي",
      "bulk.step2Text":
        "الصق القالب في ChatGPT أو Claude أو أي ذكاء اصطناعي. ثم أضف عناوينك، مثلاً:",
      "bulk.example":
        "«هذه أفلامي: Breaking Bad، Interstellar، Attack on Titan…»",
      "bulk.step3Title": "الصق القائمة المعبأة",
      "bulk.step3Text":
        "انسخ ما أعاده الذكاء الاصطناعي والصقه هنا. سنضيف كل عنوان صالح دفعة واحدة.",
      "bulk.pastePlaceholder": "الصق هنا…",
      "bulk.pasteLabel": "الصق القائمة المعبأة من الذكاء الاصطناعي",
      "bulk.readFailed": "تعذر قراءة ما لصقته.",
      "bulk.allDuplicates": "كل العناوين موجودة في قائمتك بالفعل.",
      "bulk.noneAdded": "لم يُضف أي عنوان.",
      "bulk.duplicatesSkipped": "تم تخطي {count} مكرر.",
      "bulk.duplicatesSkippedPlural": "تم تخطي {count} عنوان مكرر.",
      "error.cloudSyncFailed": "حُفظ محلياً، لكن فشلت المزامنة مع السحابة. حاول مرة أخرى.",
      "error.loadWatchlistFailed": "تعذر تحميل بيانات القائمة",
      "error.loadWatchlistHint": "جرّب تسجيل الخروج والدخول مجدداً، أو امسح بيانات الموقع لهذه الصفحة.",
      "dialog.notice": "تنبيه",
      "dialog.sure": "هل أنت متأكد؟",
      "gate.title": "ليالينا السينمائية",
      "gate.openList": "تسجيل الدخول",
      "gate.newList": "إنشاء حساب جديد",
      "gate.access": "الدخول إلى الحساب",
      "gate.codeSaveWarning":
        "اكتب رمزك واحتفظ به في مكان آمن. إذا فقدته، لا يمكننا استعادة حسابك أو قوائمك.",
      "gate.rulesLabel": "متطلبات الرمز",
      "gate.ruleLength": "6 أحرف أو أكثر",
      "gate.ruleChars": "حروف وأرقام",
      "gate.ruleSpaces": "بدون مسافات",
      "gate.ruleCaps": "حالة الأحرف لا تهم",
      "gate.showCode": "إظهار الرمز",
      "gate.hideCode": "إخفاء الرمز",
      "gate.yourCode": "رمزك",
      "gate.chooseCode": "اختر رمزاً",
      "gate.confirmCode": "تأكيد الرمز",
      "gate.open": "تسجيل الدخول",
      "gate.createList": "إنشاء حساب",
      "gate.noList": "لا يوجد حساب بهذا الرمز. أنشئ حساباً جديداً.",
      "gate.codesMismatch": "الرمزان غير متطابقين.",
      "gate.codeExists": "يوجد حساب بهذا الرمز. استخدم تسجيل الدخول بدلاً من ذلك.",
      "gate.deleted": "تم حذف الحساب. يمكنك إنشاء حساباً جديداً بنفس الرمز.",
      "auth.spaces": "المسافات غير مسموحة.",
      "auth.minLength": "استخدم {n} أحرف على الأقل.",
      "auth.needLetter": "استخدم حرفاً واحداً على الأقل.",
      "auth.needNumber": "استخدم رقماً واحداً على الأقل.",
      "auth.listNameRequired": "أدخل اسماً للقائمة.",
      "auth.listNameLong": "اجعل الاسم أقل من 48 حرفاً.",
      "mobile.notWatched": "لم تُشاهد بعد",
      "mobile.watchedUnrated": "شُوهدت — لم تُقيَّم بعد",
      "mobile.rateTitle": "قيّم هذا العنوان",
      "mobile.editRating": "تعديل التقييم",
      "mobile.close": "إغلاق",
      "alert.genreRequired": "اختر التصنيف الرئيسي قبل الإضافة.",
      "alert.genreRequiredTitle": "التصنيف مطلوب",
      "alert.incomplete": "هذا العنوان يفتقد ملخصاً. أضفه يدوياً.",
      "alert.incompleteTitle": "بيانات ناقصة",
      "alert.noLeads": "أضف ممثلاً رئيسياً واحداً على الأقل قبل الحفظ.",
      "alert.noLeadsTitle": "الممثلون مطلوبون",
      "alert.duplicate": "هذا العنوان موجود في قائمتك.",
      "alert.duplicateTitle": "مضاف مسبقاً",
      "alert.leadRequired": "أضف ممثلاً رئيسياً واحداً على الأقل.",
      "alert.leadRequiredTitle": "الممثلون الرئيسيون",
      "alert.invalidLink": "أدخل رابطاً صالحاً (IMDb أو AniList أو MyAnimeList).",
      "alert.invalidLinkTitle": "رابط غير صالح",
      "alert.nameExists": "عنوان بهذا الاسم موجود في هذا النوع.",
      "alert.nameExistsTitle": "عنوان مكرر",
      "alert.missingActors":
        "لم يُعثر على ممثلين لهذا العنوان. أضفه يدوياً.",
      "alert.missingActorsTitle": "ممثلون مفقودون",
      "alert.duplicateOnList": "عنوان بهذا الاسم موجود في قائمتك.",
      "alert.codeUpdated":
        "سجّل الدخول بالرمز الجديد من الآن، وشاركه فقط مع من تثق بهم.",
      "alert.codeUpdatedTitle": "تم تحديث الرمز",
      "alert.couldNotMoveTitle": "تعذر النقل",
      "alert.titleCopied": "تم نسخ «{title}» إلى {listName}.",
      "alert.titleCopiedTitle": "تم النسخ للقائمة",
      "alert.titleNotFound": "العنوان غير موجود.",
      "alert.alreadyOnThisList": "هذا العنوان موجود في هذه القائمة.",
      "alert.alreadyOnList": "«{title}» موجود في {listName}.",
      "alert.deleteAccountConfirm":
        "هل تريد حذف حسابك وكل {lists}؟ سيصبح رمز الدخول متاحاً مرة أخرى.",
      "alert.deleteAccountTitle": "حذف الحساب؟",
      "alert.partialDeleteAccount":
        "تم الحذف من هذا الجهاز، لكن فشل الحذف من السحابة. جرّب حذف الحساب مرة أخرى.",
      "alert.partialDeleteAccountTitle": "حذف جزئي",
      "alert.deleteListConfirm":
        "هل تريد حذف «{label}» ({titles})؟ حسابك وقوائمك الأخرى تبقى.",
      "alert.deleteListTitle": "حذف القائمة؟",
      "alert.partialDeleteList":
        "تم الحذف من هذا الجهاز، لكن فشل الحذف من السحابة. جرّب الحذف مرة أخرى أو تحقق من الاتصال.",
      "alert.partialDeleteListTitle": "حذف جزئي",
      "alert.bulkTemplateCopied":
        "تم نسخ القالب. الصقه في الذكاء الاصطناعي، أضف عناوينك، ثم الصق JSON المعبأ هنا.",
      "alert.bulkTemplateCopiedTitle": "تم النسخ",
      "alert.bulkCopyFailed":
        "تعذر النسخ تلقائياً. انسخ نص القالب من تعليمات الذكاء الاصطناعي يدوياً.",
      "alert.bulkCopyFailedTitle": "فشل النسخ",
      "alert.bulkAddedOne": "تمت إضافة عنوان واحد لقائمتك.{extra}",
      "alert.bulkAddedMany": "تمت إضافة {added} عناوين لقائمتك.{extra}",
      "alert.bulkAddedTitle": "تمت إضافة العناوين",
      "alert.missingActorTitle": "ممثل مفقود",
      "alert.deleteTitleConfirm":
        "هل تريد إزالة «{name}» من قائمتك؟ لا يمكن التراجع عن هذا.",
      "alert.deleteTitleTitle": "حذف العنوان",
      "alert.importFailedTitle": "فشل الاستيراد",
      "alert.couldNotCreateList": "تعذر إنشاء قائمة جديدة.",
      "alert.savedLocallyCloudFail":
        "تم الإنشاء محلياً، لكن فشلت المزامنة السحابية. قائمتك الجديدة على هذا الجهاز.",
      "alert.savedLocally":
        "تم الحفظ على هذا الجهاز، لكن فشلت المزامنة السحابية. تغييراتك ما زالت هنا محلياً.",
      "alert.cloudSyncFailed":
        "تغييراتك على هذا الجهاز، لكن فشل النسخ الاحتياطي. تحقق من اتصالك واضغط إعادة المحاولة في الأعلى.",
      "alert.cloudSyncFailedDelete":
        "تم الحذف على هذا الجهاز، لكن لم يُحدَّث النسخ الاحتياطي. اضغط إعادة المحاولة عندما تعود للاتصال.",
      "alert.savedLocallyTitle": "على هذا الجهاز فقط",
      "alert.listShared":
        "إذا اكتملت المشاركة، يمكن لصديقك فتح الرابط وتسجيل الدخول واستيراد قائمتك.",
      "alert.listSharedTitle": "تمت مشاركة القائمة",
      "alert.listSharedLink":
        "يمكن لصديقك فتح الرابط، تسجيل الدخول أو إنشاء قائمة، ثم اختيار طريقة الاستيراد.",
      "alert.listSharedFile":
        "إذا اكتملت المشاركة، يمكن لصديقك استيراد الملف من مشاركة ← استيراد قائمة.",
      "alert.linkCopied":
        "تم نسخ الرابط. الصقه في واتساب أو البريد أو أي تطبيق.",
      "alert.copyLinkManualTitle": "انسخ هذا الرابط",
      "alert.shareLinkFailed":
        "تعذر إنشاء رابط مشاركة. يتم إرسال ملف بدلاً من ذلك.",
      "alert.shareLinkFailedTitle": "الرابط غير متاح",
      "alert.shareLinkExpired": "انتهت صلاحية رابط المشاركة. اطلب من صديقك إرسال رابط جديد.",
      "alert.shareLinkInvalid": "رابط المشاركة غير صالح أو لم يعد متاحاً.",
      "alert.shareNeedsCloud":
        "روابط المشاركة تحتاج المزامنة السحابية. اطلب من صديقك إرسال ملف بدلاً من ذلك.",
      "alert.shareLocalhost":
        "تم إنشاء الرابط على جهازك (localhost) ولا يستطيع أصدقاؤك فتحه. افتح التطبيق من موقع GitHub Pages وشارك من هناك، أو ضع publicAppUrl في js/config.js لرابط موقعك الحي.",
      "alert.shareLocalhostTitle": "استخدم رابط الموقع الحي",
      "alert.listReadyToSend":
        "تم تنزيل ملف قائمتك. أرسله عبر واتساب أو البريد أو أي تطبيق. صديقك يفتح التطبيق ← مشاركة ← استيراد قائمة.",
      "alert.listReadyToSendTitle": "القائمة جاهزة للإرسال",
      "alert.importOpenedNewList":
        "تم فتح «{name}» كقائمة جديدة. قائمتك السابقة لم تتغير.",
      "alert.importMerged": "تمت إضافة عناوين جديدة لقائمتك الحالية.",
      "alert.importMergedSkips": "تمت إضافة {added}. {skipped} عنواناً مكرراً كان موجوداً مسبقاً.",
      "alert.importReplaced": "تم تحديث قائمتك الحالية بالملف المستورد.",
      "alert.newListCreatedTitle": "قائمة جديدة",
      "alert.listUpdatedTitle": "تم تحديث القائمة",
      "alert.couldNotOpenFile":
        "تعذر قراءة هذا الملف. اطلب من صديقك إرسال ملف منزّل من هذا التطبيق.",
      "alert.couldNotOpenFileTitle": "تعذر فتح الملف",
      "alert.importEmptyList": "لا توجد عناوين في هذا الملف أو الرابط للاستيراد.",
      "alert.importEmptyListTitle": "لا شيء للاستيراد",
      "alert.importMergeConfirm":
        "إضافة {count} عنواناً من «{listName}» إلى «{currentName}»؟ سيتم تخطي المكررات.",
      "alert.importMergeTitle": "إضافة للقائمة الحالية؟",
      "alert.importReplaceConfirm":
        "استبدال «{currentName}» بـ «{listName}» ({count} عنواناً)؟ ستفقد قائمتك الحالية.",
      "alert.importAddConfirm":
        "إضافة {count} عنواناً من «{listName}» لقائمتك؟",
      "alert.importReplaceTitle": "استبدال القائمة الحالية؟",
      "alert.importAddTitle": "إضافة لهذه القائمة؟",
      "btn.addTitles": "إضافة العناوين",
      "btn.replaceList": "استبدال القائمة",
      "alert.codeUpgrade":
        "رمزك القديم (مثل 1234) لم يعد يلائم القواعد الجديدة. اختر رمزاً شخصياً جديداً بحروف وأرقام — 6 أحرف على الأقل.",
      "alert.codeUpgradeTitle": "حدّث رمز الدخول",
      "list.myList": "قائمتي",
      "list.thisList": "هذه القائمة",
      "list.sharedList": "قائمة مشتركة",
      "list.importedList": "قائمة مستوردة",
      "list.thisTitle": "هذا العنوان",
      "plural.oneList": "قائمة واحدة",
      "plural.otherLists": "{count} قوائم",
      "plural.oneTitle": "عنوان واحد",
      "plural.otherTitles": "{count} عناوين",
      "searchResult.movie": "فيلم",
      "searchResult.series": "مسلسل",
      "searchResult.anime": "أنمي",
      "searchResult.episode": "حلقة",
      "searchResult.title": "عنوان",
    },
  };

  const GENRE_SLUGS = {
    Action: "action",
    Adventure: "adventure",
    Animation: "animation",
    Comedy: "comedy",
    Crime: "crime",
    Documentary: "documentary",
    Drama: "drama",
    Family: "family",
    Fantasy: "fantasy",
    Historical: "historical",
    Horror: "horror",
    Mystery: "mystery",
    Romance: "romance",
    "Science Fiction": "scienceFiction",
    Sports: "sports",
    Thriller: "thriller",
    War: "war",
    Western: "western",
  };

  const AUTH_ERROR_MAP = {
    "Spaces are not allowed.": "auth.spaces",
    "Use at least one letter.": "auth.needLetter",
    "Use at least one number.": "auth.needNumber",
    "Give your list a name.": "auth.listNameRequired",
    "Keep the name under 48 characters.": "auth.listNameLong",
  };

  const APP_MESSAGE_MAP = {
    "Codes do not match.": "changeCode.codesMismatch",
    "That code is already in use. Pick another.": "changeCode.codeInUse",
    "Could not update cloud account. Try again.": "changeCode.cloudFailed",
    "Saved locally, but cloud sync failed. Try again.": "error.cloudSyncFailed",
    "Could not read that paste.": "bulk.readFailed",
    "Every title was already on your list.": "bulk.allDuplicates",
    "No titles could be added.": "bulk.noneAdded",
    "Tap a star to choose your score first.": "rating.chooseStarFirst",
    "Could not load watchlist data": "error.loadWatchlistFailed",
    "Make sure js/data.js is present.": "error.loadWatchlistHint",
  };

  function getLang() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(saved) ? saved : "en";
  }

  function isRtl() {
    return getLang() === "ar";
  }

  function t(key, vars = {}) {
    const lang = getLang();
    const pack = MESSAGES[lang] || MESSAGES.en;
    let text = pack[key] ?? MESSAGES.en[key] ?? key;
    Object.entries(vars).forEach(([name, value]) => {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    });
    return text;
  }

  function titleCount(count) {
    return count === 1 ? t("genre.oneTitle") : t("genre.otherTitles", { count });
  }

  function listCountPhrase(count) {
    return count === 1 ? t("plural.oneList") : t("plural.otherLists", { count });
  }

  function titleCountPhrase(count) {
    return count === 1 ? t("plural.oneTitle") : t("plural.otherTitles", { count });
  }

  function isolateLtr(text) {
    const value = String(text ?? "");
    if (!value || getLang() !== "ar") return value;
    return `\u2066${value}\u2069`;
  }

  function genreLabel(genre) {
    if (!genre) return "";
    const slug = GENRE_SLUGS[genre];
    return slug ? t(`genreName.${slug}`) : genre;
  }

  function translateAuthError(message, vars = {}) {
    if (!message) return "";
    if (message.startsWith("Use at least ") && message.endsWith(" characters.")) {
      const n = message.match(/\d+/)?.[0];
      return t("auth.minLength", { n: n || "6" });
    }
    const key = AUTH_ERROR_MAP[message];
    return key ? t(key, vars) : message;
  }

  function translateAppMessage(message, vars = {}) {
    if (!message) return "";
    const key = APP_MESSAGE_MAP[message];
    return key ? t(key, vars) : message;
  }

  function setText(sel, key, vars) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (el) el.textContent = t(key, vars);
  }

  function setHtml(sel, key) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (el) el.innerHTML = t(key);
  }

  function setPlaceholder(sel, key) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (el) el.placeholder = t(key);
  }

  function setAria(sel, key) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (el) el.setAttribute("aria-label", t(key));
  }

  function applySkipLinkText() {
    setText(".skip-link", "a11y.skipToMain");
  }

  function applyDocument() {
    applySkipLinkText();
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });

    setText("#addBtn", "btn.addTitle");
    setText(".account-menu__trigger-label", "menu.label");
    setText("[data-action='manage-lists']", "menu.manageLists");
    setText("[data-action='share']", "menu.share");
    setText("[data-action='open-theme']", "menu.theme");
    setText("[data-action='open-about']", "menu.about");
    setText("[data-action='change-code']", "menu.changeCode");
    setText("[data-action='delete-account']", "menu.deleteAccount");
    setText("[data-action='sign-out']", "menu.signOut");
    setText("#accountMenuLangLabel", "menu.language");
    setText("#themeModalTitle", "menu.theme");
    setText("#themeModalIntro", "theme.modalIntro");
    document.querySelectorAll("[data-theme-label]").forEach((el) => {
      const id = el.dataset.themeLabel;
      if (id) el.textContent = t(`theme.${id}`);
    });
    setText("#themeModal .modal__footer .btn--ghost", "btn.close");
    window.WatchlistThemes?.applyThemeUi?.();
    setText("#loading", "loading.watchlist");
    setText(".footer p", "footer.hint");
    setText("#linkPreviewPopoverInner .link-preview-popover__loading", "preview.loading");

    document.querySelectorAll(".type-tab").forEach((tab) => {
      const label = tab.querySelector(".type-tab__label");
      const type = tab.dataset.type;
      if (label && type) label.textContent = t(`tab.${type}`);
    });

    setPlaceholder("#searchInput", "filter.searchPlaceholder");
    setAria("#genreSelect", "filter.byGenre");
    setAria("#watchedFilter", "filter.byWatched");
    setAria("#ratingFilter", "filter.byRating");

    const watched = document.getElementById("watchedFilter");
    if (watched?.options?.length >= 3) {
      watched.options[0].textContent = t("filter.all");
      watched.options[1].textContent = t("filter.watched");
      watched.options[2].textContent = t("filter.unwatched");
    }

    const searchType = document.getElementById("titleSearchType");
    if (searchType) {
      [...searchType.options].forEach((opt) => {
        if (opt.value === "all") opt.textContent = t("search.type.all");
        if (opt.value === "movie") opt.textContent = t("search.type.movie");
        if (opt.value === "series") opt.textContent = t("search.type.series");
        if (opt.value === "anime") opt.textContent = t("search.type.anime");
      });
    }

    document.querySelectorAll(".content-type-picker [data-type]").forEach((btn) => {
      const type = btn.dataset.type;
      if (type === "movies") btn.textContent = t("type.movie");
      if (type === "tvSeries") btn.textContent = t("type.tvSeries");
      if (type === "anime") btn.textContent = t("type.anime");
    });

    document.querySelectorAll("[data-layout]").forEach((btn) => {
      const layout = btn.dataset.layout;
      if (layout === "hover") {
        btn.dataset.tip = t("layout.hover");
        btn.setAttribute("aria-label", t("layout.hover"));
      }
      if (layout === "poster") {
        btn.dataset.tip = t("layout.poster");
        btn.setAttribute("aria-label", t("layout.poster"));
      }
    });

    setAria("#layoutToggles", "layout.toolbar");
    setAria(".panel", "panel.filters");
    setAria("#addModeTabs", "add.mode");
    setAria("#formTypePicker", "form.type");
    setAria("#searchConfirmTypePicker", "form.type");
    setAria("#listSwitcher", "menu.switchList");
    setText("label[for='listSwitcher']", "menu.switchList");

    setHtml("#searchAddStep .add-panel-hint", "search.hint");
    setText("#searchAddStep .form-field__label", "search.label");
    setPlaceholder("#titleSearchInput", "search.placeholder");
    setText(".title-search__filter-label", "search.typeLabel");
    setText("#titleSearchMore", "btn.loadMore");
    setText("#searchConfirmBack", "search.back");
    setText("#searchConfirmStep .form-field:nth-child(1) .form-field__label", "form.type");
    setText("#searchConfirmStep label.form-field .form-field__label", "search.mainGenre");
    setText(
      "#searchConfirmStep .form-field:has(#searchConfirmSecondaryAdd) .form-field__label",
      "form.secondaryGenres"
    );
    setText("#searchConfirmAdd", "btn.addToList");

    setHtml(".add-panel-hint--manual", "manual.hint");
    setText("#itemForm .form-field:nth-child(1) .form-field__label", "manual.link");
    setPlaceholder("#formLink", "manual.linkPlaceholder");

    const formLabels = {
      "#itemForm .form-field:has(#formTypePicker) .form-field__label": "form.type",
      "#itemForm label:has(#formGenre) .form-field__label": "form.mainGenre",
      "#itemForm .form-field:has(#formSecondaryAdd) .form-field__label": "form.secondaryGenres",
      "#itemForm label:has(#formTitle) .form-field__label": "form.title",
      "#itemForm .form-field:has(#formLeadInput) .form-field__label": "form.leads",
      "#itemForm label:has(#formSummary) .form-field__label": "form.summary",
    };
    Object.entries(formLabels).forEach(([sel, key]) => setText(sel, key));

    setPlaceholder("#formLeadInput", "form.actorPlaceholder");
    setText("#formLeadAdd", "form.add");
    setText("#deleteBtn", "btn.delete");
    setText("#itemForm .modal__footer-right .btn--ghost", "btn.cancel");
    setText("#itemForm .modal__footer-right .btn--primary", "btn.save");

    document.querySelectorAll(".add-mode-tab").forEach((tab) => {
      const mode = tab.dataset.addMode;
      if (mode === "search") tab.textContent = t("add.search");
      if (mode === "manual") tab.textContent = t("add.manual");
      if (mode === "bulk") tab.textContent = t("add.bulk");
    });

    setText("#changeCodeModalTitle", "changeCode.title");
    setText("#changeCodeForm .backup-modal__text", "changeCode.text");
    setText("label:has(#changeCodeNew) .form-field__label", "changeCode.new");
    setText("label:has(#changeCodeConfirm) .form-field__label", "changeCode.confirm");
    setText("#changeCodeForm .btn--ghost", "btn.cancel");
    setText("#changeCodeSubmit", "btn.updateCode");

    setText("#shareModalTitle", "share.title");
    setText(".share-modal__tagline", "share.tagline");
    setText(".share-modal__intro", "share.intro");
    setText(".share-modal__note", "share.note");
    setText("[data-action='share-send'] .share-option__title", "share.sendTitle");
    setText("[data-action='share-send'] .share-option__desc", "share.sendDesc");
    setText("[data-action='share-receive'] .share-option__title", "share.importTitle");
    setText("[data-action='share-receive'] .share-option__desc", "share.importDesc");
    setText("#shareModal .btn--ghost", "btn.cancel");

    setText("#manageListsModalTitle", "manage.title");
    setText("[data-action='create-new-list']", "manage.create");
    setText("#manageListsModal .btn--ghost", "btn.close");

    setText("label:has(#createListName) .form-field__label", "create.name");
    setPlaceholder("#createListName", "create.namePlaceholder");
    setText("label:has(#createListDescription) .form-field__label", "create.about");
    setPlaceholder("#createListDescription", "create.aboutPlaceholder");
    setText("#createListForm .btn--ghost", "btn.cancel");
    setText("#createListSubmit", "btn.createList");

    setText("#ratingModalTitle", "rating.title");
    setText("#moveListModal .btn--ghost", "btn.cancel");
    setText("#importShareModalTitle", "import.title");
    setText("#importShareModalHint", "import.hint");
    setText("[data-action='import-new-list']", "import.newList");
    setText("#importMergeBtn", "import.merge");
    setText("#importReplaceBtn", "import.replace");
    setText("#importShareModal .btn--text", "btn.cancel");

    setText("#searchAddPanel .modal__footer .btn--ghost", "btn.cancel");
    setText("#bulkAddPanel .modal__footer .btn--ghost", "btn.cancel");
    setText("#bulkAddConfirm", "btn.addAllTitles");
    setText(".bulk-add__headline", "bulk.headline");
    setText(".bulk-add__step:nth-child(1) .bulk-add__step-title", "bulk.step1Title");
    setText(".bulk-add__step:nth-child(1) p", "bulk.step1Text");
    setText("#copyBulkTemplate", "btn.copyTemplate");
    setText(".bulk-add__step:nth-child(2) .bulk-add__step-title", "bulk.step2Title");
    setText(".bulk-add__step:nth-child(2) .bulk-add__step-body > p:nth-of-type(1)", "bulk.step2Text");
    setText(".bulk-add__example", "bulk.example");
    setText(".bulk-add__step:nth-child(3) .bulk-add__step-title", "bulk.step3Title");
    setText(".bulk-add__step:nth-child(3) .bulk-add__step-body > p", "bulk.step3Text");
    setPlaceholder("#bulkPasteInput", "bulk.pastePlaceholder");
    setAria("#bulkPasteInput", "bulk.pasteLabel");

    setText("label:has(#ratingPicker) .form-field__label", "rating.yourScore");
    setAria(".rating-picker__stars", "rating.starsGroup");
    setText(".rating-picker__fine-label", "rating.fineTune");
    setText("label:has(#ratingNote) .form-field__label", "rating.note");
    setPlaceholder("#ratingNote", "rating.notePlaceholder");
    setText("[data-action='rate-later']", "btn.rateLater");
    setText("#ratingForm .btn--primary", "btn.saveRating");

    document.querySelectorAll("[data-rating-star]").forEach((btn) => {
      const n = btn.dataset.ratingStar;
      btn.setAttribute("aria-label", t("rating.star", { n }));
    });
    document.querySelector("[data-rating-adjust='-0.1']")?.setAttribute("aria-label", t("rating.lower"));
    document.querySelector("[data-rating-adjust='0.1']")?.setAttribute("aria-label", t("rating.raise"));

    document.querySelectorAll(".modal__close, [aria-label='Close']").forEach((btn) => {
      if (btn.getAttribute("aria-label") === "Close" || btn.classList.contains("modal__close")) {
        btn.setAttribute("aria-label", t("modal.close"));
      }
    });

    document.querySelectorAll("[data-action='set-language']").forEach((btn) => {
      btn.classList.toggle("account-menu__lang-btn--active", btn.dataset.lang === getLang());
    });

    const headerTitle = document.getElementById("headerTitle");
    if (headerTitle && !window.WatchlistAuth?.getListLabel?.()) {
      headerTitle.textContent = t("app.title");
    }
    document.title = t("app.title");
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t("app.description");
  }

  function applyAboutDocument() {
    applySkipLinkText();
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });

    const supportEl = document.getElementById("aboutSupportLink");
    const supportUrl = String(window.WATCHLIST_CONFIG?.supportUrl || "").trim();
    if (supportEl) {
      if (supportUrl) {
        supportEl.href = supportUrl;
        supportEl.textContent = supportUrl.replace(/^mailto:/i, "");
        supportEl.target = supportUrl.startsWith("http") ? "_blank" : "";
        supportEl.rel = supportUrl.startsWith("http") ? "noopener noreferrer" : "";
      } else {
        supportEl.removeAttribute("href");
        supportEl.removeAttribute("target");
        supportEl.removeAttribute("rel");
        supportEl.textContent = t("about.supportFallback");
      }
    }

    const goAppBtn = document.querySelector("[data-action='go-app']");
    if (goAppBtn) goAppBtn.textContent = t("about.openApp");

    document.title = t("about.pageTitle");
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t("about.tagline");

    document.querySelectorAll("[data-action='set-language']").forEach((btn) => {
      btn.classList.toggle("about__lang-btn--active", btn.dataset.lang === getLang());
    });
  }

  function applyLanguage(lang) {
    const next = SUPPORTED.includes(lang) ? lang : "en";
    localStorage.setItem(STORAGE_KEY, next);
    const root = document.documentElement;
    root.lang = next;
    root.dir = next === "ar" ? "rtl" : "ltr";
    if (document.body?.dataset?.page === "about") {
      applyAboutDocument();
    } else {
      applyDocument();
    }
    listeners.forEach((fn) => fn(next));
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function applyGateDocument() {
    applySkipLinkText();
    setText(".gate__title", "gate.title");
    setText(".gate__mode[data-mode='open']", "gate.openList");
    setText(".gate__mode[data-mode='create']", "gate.newList");
    setAria(".gate__modes", "gate.access");
    const ruleKeys = [
      "gate.ruleLength",
      "gate.ruleChars",
      "gate.ruleSpaces",
    ];
    const rulesList = document.getElementById("createCodeRules");
    if (rulesList) {
      setAria(rulesList, "gate.rulesLabel");
      rulesList.querySelectorAll(".gate__rule").forEach((item, index) => {
        if (ruleKeys[index]) item.textContent = t(ruleKeys[index]);
      });
    }
    setText("#createCodeHint", "gate.ruleCaps");
    setText("#createCodeWarning", "gate.codeSaveWarning");
    document.querySelectorAll("[data-action='toggle-password']").forEach((btn) => {
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-label", t(pressed ? "gate.hideCode" : "gate.showCode"));
    });
    setPlaceholder("#openCode", "gate.yourCode");
    setPlaceholder("#createCode", "gate.chooseCode");
    setPlaceholder("#confirmCode", "gate.confirmCode");
    setText("#openForm .gate__submit", "gate.open");
    setText("#createForm .gate__submit", "gate.createList");
    setText(".gate__about-link a", "menu.about");
    setText(".gate__theme-label", "menu.theme");
    setText("#themeModalTitle", "menu.theme");
    setText("#themeModalIntro", "theme.modalIntro");
    document.querySelectorAll("[data-theme-label]").forEach((el) => {
      const id = el.dataset.themeLabel;
      if (id) el.textContent = t(`theme.${id}`);
    });
    setText("#themeModal .modal__footer .btn--ghost", "btn.close");
    window.WatchlistThemes?.applyThemeUi?.();
    document.title = t("gate.title");
    document.querySelectorAll("[data-action='set-language']").forEach((btn) => {
      btn.classList.toggle("gate__lang-btn--active", btn.dataset.lang === getLang());
    });
  }

  function init() {
    applyLanguage(getLang());
  }

  window.WatchlistI18n = {
    t,
    getLang,
    setLang: applyLanguage,
    isRtl,
    onChange,
    applyDocument,
    applyGateDocument,
    applyAboutDocument,
    titleCount,
    listCountPhrase,
    titleCountPhrase,
    isolateLtr,
    genreLabel,
    translateAuthError,
    translateAppMessage,
    MESSAGES,
  };

  if (document.documentElement) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
