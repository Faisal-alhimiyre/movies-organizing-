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
      "btn.copyTemplate": "Copy prompt",
      "menu.label": "Menu",
      "menu.switchList": "Switch list",
      "menu.manageLists": "Manage lists",
      "menu.share": "Share",
      "menu.changeCode": "Change code",
      "menu.deleteAccount": "Delete account",
      "menu.signOut": "Sign out",
      "menu.language": "Language",
      "menu.theme": "Theme",
      "theme.dark": "Dark",
      "theme.light": "Light",
      "theme.purple": "Purple",
      "theme.brown": "Brown",
      "theme.pink": "Pink",
      "theme.modalIntro": "Pick how the app looks. Your choice is saved on this device.",
      "theme.desc.midnight": "Clean dark UI",
      "theme.desc.light": "Clean paper white",
      "theme.desc.purple": "Deep jewel tones",
      "theme.desc.brown": "Creamy chocolate latte",
      "theme.desc.pink": "Strawberry jam gloss",
      "lang.en": "English",
      "lang.ar": "العربية",
      "tab.all": "All",
      "tab.movies": "Movies",
      "tab.tvSeries": "TV Series",
      "tab.anime": "Anime",
      "filter.searchPlaceholder": "Search titles or actors",
      "filter.searchScope": " in your list",
      "filter.searchPlaceholderRich":
        'Search titles or actors<span class="search__scope-hl"> in your list</span>',
      "filter.searchAria": "Search titles or actors in your list",
      "filter.searchClear": "Clear search",
      "filter.allGenres": "All genres",
      "filter.addGenre": "Add genre…",
      "filter.labelGenre": "Genre",
      "filter.labelWatched": "Status",
      "filter.labelDuration": "Duration",
      "filter.labelEpisodes": "Episodes",
      "filter.labelSort": "Sort",
      "filter.metricAll": "All",
      "filter.durationAll": "All durations",
      "filter.durationShort": "Short (< 90 min)",
      "filter.durationMedium": "Medium (90-120 min)",
      "filter.durationLong": "Long (> 120 min)",
      "filter.episodesAll": "All episode counts",
      "filter.episodes1to12": "1-12 episodes",
      "filter.episodes13to24": "13-24 episodes",
      "filter.episodes25to50": "25-50 episodes",
      "filter.episodes51Plus": "51+ episodes",
      "filter.all": "All",
      "filter.watched": "Watched",
      "filter.inProgress": "In progress",
      "filter.unwatched": "Not watched",
      "filter.byGenre": "Filter by genre (primary or secondary)",
      "filter.byWatched": "Filter by watched status",
      "filter.byRating": "Sort by",
      "chip.removeFilter": "Remove {genre} filter",
      "chip.removeGenre": "Remove {genre}",
      "chip.removeLead": "Remove {name}",
      "chip.activeFilters": "Active genre filters",
      "filter.ratingOptionAll": "Default order",
      "filter.ratingOptionAdded": "Recently added",
      "filter.ratingOptionRelease": "Release date",
      "filter.ratingOptionAge": "Age rating",
      "filter.ratingOptionDuration": "Durations",
      "filter.ratingOptionEpisodes": "Episodes",
      "filter.ratingOptionImdb": "IMDb ratings",
      "filter.ratingOptionAnilist": "AniList ratings",
      "filter.ratingOptionPersonal": "My ratings",
      "filter.ratingOptionAddedNewest": "Recently added",
      "filter.ratingOptionAddedOldest": "Oldest first",
      "filter.ratingOptionImdbBest": "IMDb — highest first",
      "filter.ratingOptionImdbWorst": "IMDb — lowest first",
      "filter.ratingOptionAnilistBest": "AniList — highest first",
      "filter.ratingOptionAnilistWorst": "AniList — lowest first",
      "filter.ratingOptionPersonalBest": "My rating — highest first",
      "filter.ratingOptionPersonalWorst": "My rating — lowest first",
      "filter.sortDirection": "Toggle sort direction",
      "filter.sortNewestFirst": "Newest first",
      "filter.sortOldestFirst": "Oldest first",
      "filter.sortHighestFirst": "Highest first",
      "filter.sortLowestFirst": "Lowest first",
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
      "stats.inProgressWord": "in progress",
      "stats.filterAll": "Show all titles",
      "stats.filterWatched": "Show watched titles",
      "stats.filterInProgress": "Show in progress titles",
      "sync.savingShort": "Saving…",
      "sync.cloudRestore": "Your cloud list is being restored",
      "sync.cloudRestoreTitle": "Restore from cloud",
      "sync.cloudRestoreFailed": "Could not restore your list from the cloud. Check your connection and try again.",
      "sync.failedShort": "Backup failed",
      "sync.savedShort": "Saved",
      "sync.offlineShort": "Offline",
      "sync.retry": "Retry",
      "sync.retryAria": "Retry backup",
      "sync.saving": " · saving…",
      "sync.failed": " · save failed",
      "sync.saved": " · saved",
      "sync.cacheRecoveryTitle": "Missing titles detected",
      "sync.cacheRecoveryPrompt":
        "Your list shows {current} titles, but a local backup has {cached} ({gap} more). Restore the backup? This will replace your current list and sync to the cloud.",
      "ptr.refreshing": "Refreshing…",
      "ptr.failed": "Could not refresh. Showing your saved list.",
      "empty.noTitles": "Your watchlist is empty",
      "empty.noTitlesHint":
        "Search for one title, import a whole list, or add details yourself.",
      "empty.firstTitle": "Add your first title",
      "empty.firstSubtitle": "Pick any way below — you can mix them anytime.",
      "empty.hintSearch": "Search add — find movies, TV, or anime by name",
      "empty.hintLink": "Manual add — paste an IMDb or AniList link",
      "empty.hintBulk": "Import list — paste titles from ChatGPT or a notes app",
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
      "empty.releaseYearLoading": "Loading release years for your titles…",
      "empty.releaseYearMissing":
        "Release years are not saved yet. They load automatically from IMDb/AniList — give it a moment, or add titles via search.",
      "empty.ageRatingLoading": "Loading age ratings for your titles…",
      "empty.ageRatingMissing":
        "Age ratings are not saved yet. They load automatically from IMDb/AniList — give it a moment, or add titles via search.",
      "empty.yearsNeedConfig":
        "Movie years need an OMDb or TMDB key in config.js on the live site. Anime years still load from AniList.",
      "ratings.backfillProgress": "Loading ratings… {done}/{total}",
      "ratings.backfillAnilist": "Loading AniList scores… {done}/{total}",
      "ratings.backfillImdb": "Loading IMDb ratings… {done}/{total}",
      "ratings.backfillYear": "Loading release years… {done}/{total}",
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
      "card.inProgress": "In progress",
      "card.inProgressShort": "Progress",
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
      "card.releaseYear": "Release year",
      "card.sectionDetails": "Details",
      "card.sectionTitle": "Title",
      "card.sectionGenres": "Genres",
      "ageRating.allAges": "All ages",
      "ageRating.kids": "Kids",
      "ageRating.ages7": "Ages 7+",
      "ageRating.parentalGuidance": "Parental guidance",
      "ageRating.ages13": "Ages 13+",
      "ageRating.ages14": "Ages 14+",
      "ageRating.ages17": "Ages 17+",
      "ageRating.adultsOnly": "Adults only",
      "ageRating.unrated": "Unrated",
      "search.type.all": "All",
      "search.type.movie": "Movies",
      "search.type.series": "TV Series",
      "search.type.anime": "Anime",
      "search.hint":
        "<strong>Can't find your title?</strong> Tap <strong>Manual</strong> at the top and add it yourself.",
      "search.label": "Search movies & shows",
      "search.clearQuery": "Clear search",
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
      "search.back": "Back to search",
      "search.chooseGenre": "Choose genre",
      "search.mainGenre": "Main genre",
      "search.noSummary": "No summary available.",
      "search.alreadyOnList": "On your list",
      "search.pickResult": "{title} — {meta}",
      "search.addResult": "Add {title}",
      "search.added": "Added",
      "search.addedStatus": "Added: {title}",
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
      "add.bulk": "Import list",
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
      "share.step1": "Creates a link anyone can open.",
      "share.step2": "They sign in with their own account to import your titles.",
      "share.note":
        "Your private login code is never included in a share link.",
      "share.sendTitle": "Send my list",
      "share.linkMessage":
        "My movie list “{name}”{summary} — open this link to import it into Our Movie Nights.",
      "share.linkSummaryPart": " — {summary}",
      "share.arrivalTitle": "Shared list ready to import",
      "share.arrivalLoading": "Loading shared list…",
      "share.arrivalText": "“{name}” has {count} titles. Choose how to import it into your account.",
      "share.arrivalImport": "Review import",
      "share.arrivalDismiss": "Cancel",
      "share.arrivalExpired": "This share link has expired.",
      "share.arrivalInvalid": "This share link is invalid or no longer available.",
      "pwa.iconNoteTitle": "Update your home screen icon",
      "pwa.iconNoteLead":
        "We added a proper app icon (the toast robot). If yours still shows a letter “O”, refresh the shortcut once:",
      "pwa.iconNoteStep1": "Delete the old Movie Nights icon from your home screen.",
      "pwa.iconNoteStep2": "Open the site in your browser (not from the old shortcut).",
      "pwa.iconNoteStep3": "Add it to your home screen again — same way you did the first time.",
      "pwa.iconNoteDismiss": "Got it",
      "share.fileMessage":
        "My watchlist backup. Open Our Movie Nights → Share → Import a list.",
      "manage.title": "Manage lists",
      "manage.create": "Create a new list",
      "manage.unnamedList": "Unnamed list",
      "manage.myList": "My list",
      "manage.signedInNow": "Signed in now",
      "manage.defaultList": "Default list",
      "manage.assignDefault": "Assign as default",
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
        "Choose how to import these titles into your account.",
      "import.summaryWithCurrent":
        '"{listName}" has {count} titles. You\'re on "{currentName}" with {currentCount}.',
      "import.summaryEmpty": '"{listName}" has {count} titles. Your current list is empty.',
      "import.summaryWithDescription": "About: {description}",
      "import.summarySimpleWithCurrent":
        '"{listName}" has {count} titles. Import into "{currentName}"?',
      "import.summarySimpleEmpty": '"{listName}" has {count} titles. Import now?',
      "import.newList": "Open as new list",
      "import.merge": "Add to my current list",
      "import.mergeWithWatch": "Add to current list with ratings and notes",
      "import.newListFormTitle": "Name your new list",
      "import.newListFormHint":
        "Keep the shared name and summary or change them before creating the list.",
      "import.newListSubmit": "Create list",
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
      "rating.notePlaceholder": "Your thoughts",
      "rating.yourThoughts": "Your thoughts",
      "rating.thoughtsSoFar": "Thoughts so far…",
      "bulk.headline": "Add a whole list at once",
      "bulk.step1Title": "Copy the AI prompt",
      "bulk.step1Text":
        "Tap below to copy a short message for ChatGPT, Claude, or any chatbot. It asks the AI to return a simple list with each title, year, and type (movie, TV show, or anime).",
      "bulk.step2Title": "Paste into your AI",
      "bulk.step2Text":
        "Paste the prompt into your chatbot, then tell it which titles you want. For example:",
      "bulk.example":
        "“Here are my titles: Breaking Bad, Interstellar, Attack on Titan…”",
      "bulk.step3Title": "Paste or upload your list",
      "bulk.step3Text":
        "Paste what your AI sent you in the box below, or upload a file with the exact same list. Only plain text files work (.txt or .tsv) — not PDF, Word, Excel, or images.",
      "bulk.pastePlaceholder": "Paste your list here…",
      "bulk.pasteLabel": "List from your AI",
      "bulk.fileLabel": "Upload list file (.txt or .tsv)",
      "bulk.fileHint": "Same list as above — plain text only.",
      "bulk.fileWrongType":
        "That file type won’t work. Save your list as a .txt or .tsv file (plain text), not PDF, Word, or an image.",
      "bulk.fileReadFailed": "Could not read that file.",
      "bulk.pickMatch": "Choose a match…",
      "bulk.commitSkipped": "{count} titles were skipped (duplicate or incomplete).",
      "bulk.commitResult":
        "Added successfully: {added}\nAlready present: {alreadyPresent}\nGrouped: {grouped}\nFailed to add: {failed}\nStill ready: {stillReady}",
      "bulk.commitFailed": "Could not add verified titles. Try again.",
      "bulk.persistenceFailed":
        "Import progress could not be saved. Database migration or permissions need attention.",
      "bulk.addingProgress": "Adding {current} of {total}",
      "bulk.continuing": "Continuing…",
      "bulk.resolving": "Resolving…",
      "bulk.workerBusy": "Processing is already running. Wait for it to finish.",
      "bulk.continueFailed": "Could not start processing.",
      "bulk.resolveNothing": "No unresolved titles need attention.",
      "bulk.changeType": "Change type",
      "bulk.changeTypeApply": "Apply",
      "bulk.changeTypeFailed": "Could not change type. Try again when processing is idle.",
      "bulk.changeTypeHint": "Tap the type to change it, then choose Movie, TV series, or Anime.",
      "bulk.typeCorrectedNote": "Type corrected: {from} → {to}",
      "bulk.typeOriginal": "Original type",
      "bulk.typeCorrected": "Corrected type",
      "bulk.dupHeading": "Duplicate",
      "bulk.dupMatchedAgainst": "Matched against",
      "bulk.dupProvider": "Provider",
      "bulk.dupWatchlistState": "Status",
      "bulk.dupOnWatchlist": "Already on your watchlist",
      "bulk.dupImportOnly": "Only duplicated inside this import",
      "bulk.searchPlaceholder": "Search import rows…",
      "bulk.searchClear": "Clear search",
      "bulk.groupsTitle": "Grouped titles",
      "bulk.jobSubmitted": "Submitted",
      "bulk.jobProcessing": "Processing",
      "bulk.jobExact": "Verified",
      "bulk.jobPossible": "Possible matches",
      "bulk.jobDuplicates": "Duplicates",
      "bulk.jobNotFound": "Not found",
      "bulk.jobFailed": "Failed",
      "bulk.jobReady": "Ready to add",
      "bulk.jobNeedsAttention": "Needs attention",
      "bulk.jobWaiting": "Waiting",
      "bulk.jobGrouped": "Grouped",
      "bulk.jobCorrected": "Corrected",
      "bulk.jobOther": "Other",
      "bulk.jobAdded": "Added",
      "bulk.status.corrected": "Corrected",
      "bulk.importStatusIncomplete": "Import status is incomplete. Resolve hidden rows first.",
      "bulk.checkingProgress": "Checking title {current} of {total}",
      "bulk.waitingAnilist": "Waiting for AniList — retrying automatically",
      "bulk.waitingRetryIn":
        "Waiting for {provider} — retrying in {seconds} · Next retry at {time} · Resolved {resolved} of {total}",
      "bulk.queueResolved": "Resolved {resolved} of {total}",
      "bulk.matchProgress":
        "Matched {matched} of {total} — checking {remaining} remaining anime",
      "bulk.anilistPaused":
        "AniList is temporarily limited — continuing automatically at {time} · Matched {matched} of {total}",
      "credits.menu": "Credits & data sources",
      "credits.title": "Credits & data sources",
      "credits.animeAttribution":
        "Anime identity data contains information from anime-offline-database by manami-project, available under ODbL 1.0 and DbCL 1.0.",
      "credits.providersHint":
        "Movie and TV metadata may come from TMDb, OMDb, TVDB, and AniList when you search or enrich titles. Your private lists, ratings, and watch progress are stored separately and are not part of the licensed anime index.",
      "credits.indexVersion":
        "Offline anime index: release {version} · {count} titles · upstream date {updated}",
      "credits.archivedNote":
        "Offline anime index source (anime-offline-database) is an archived read-only dataset; the installed version continues to work without future upstream updates.",
      "credits.close": "Close",
      "bulk.queueOffline": "Offline — processing will resume when connection returns",
      "bulk.queueStalled":
        "Queue idle — {due} titles ready to retry · Resolved {resolved} of {total}",
      "bulk.continueProcessing": "Continue processing",
      "bulk.waitingRowDetail": "{provider} · retry {retries} · {reason}",
      "bulk.waitingRowCountdown": "in {seconds}",
      "bulk.groupsCollapsed": "Grouped titles — {count} group(s)",
      "bulk.resolveRemaining": "Resolve remaining titles",
      "bulk.exportUnresolved": "Export unresolved",
      "bulk.advancedRecovery": "Advanced recovery",
      "bulk.advancedRetry": "Retry now",
      "bulk.jobRunning": "Matching titles with providers…",
      "bulk.jobPaused": "Paused — tap Resume to continue.",
      "bulk.retryProgress": "{label} {current} of {total}",
      "bulk.filter.all": "All",
      "bulk.filter.allCount": "All — {count} titles",
      "bulk.filter.statusCount": "{status} — {count} titles",
      "bulk.filter.showAll": "Show all",
      "bulk.yearUnknown": "Unknown",
      "bulk.matchedOk": "Matched",
      "bulk.previewColProvider": "Provider",
      "bulk.previewColReason": "Reason",
      "bulk.action.retryAllFailed": "Retry all failed",
      "bulk.action.retryAnilist": "Retry AniList failures",
      "bulk.action.retryAnimeFailures": "Retry anime failures",
      "bulk.action.retryTransient": "Retry temporary failures",
      "bulk.action.retryNotFound": "Retry not found",
      "bulk.action.exportFailed": "Export failed titles",
      "bulk.action.exportNotFound": "Export not-found titles",
      "bulk.action.exportUnresolved": "Export unresolved TSV",
      "bulk.action.importCorrected": "Import corrected TSV",
      "bulk.action.addVerified": "Add to watchlist",
      "bulk.correctedImportTitle": "Import corrected TSV",
      "bulk.correctedImportDone":
        "Updated {updated} rows. Skipped {skipped}. Ambiguous matches: {ambiguous}.",
      "bulk.correctedImportFailed":
        "Could not read that TSV. Use columns: ImportItemID, Title, Year, Type, ProviderURL.",
      "bulk.pause": "Pause",
      "bulk.resume": "Resume",
      "bulk.retryFailed": "Retry failed",
      "bulk.cancelRemaining": "Cancel remaining",
      "bulk.reviewPossible": "Review possible matches",
      "bulk.reviewImport": "Check my list",
      "bulk.addVerified": "Add to watchlist",
      "bulk.addVerifiedCount": "Add to watchlist ({count})",
      "bulk.copyUnresolvedTitle": "Copy unresolved TSV",
      "bulk.copyUnresolved": "Copy unresolved TSV",
      "bulk.copyUnresolvedCopied": "Copied!",
      "bulk.copyUnresolvedEmpty": "No unresolved titles to copy.",
      "bulk.pasteCorrected": "Paste corrected TSV",
      "bulk.pasteFromClipboard": "Paste",
      "bulk.applyCorrections": "Apply corrections",
      "bulk.correctedPasteEmpty": "Paste corrected TSV text first.",
      "bulk.correctedPasteFailed": "Could not read from clipboard.",
      "bulk.correctedPasteHint":
        "Paste rows with ImportItemID, Title, Year, Type, and optional ProviderURL.",
      "bulk.replaceJobTitle": "Replace import job?",
      "bulk.replaceJobWarning":
        "You already have an import job with {count} titles in progress. Pasting again will discard that progress unless you cancel.",
      "bulk.replaceJobConfirm": "Replace job",
      "bulk.fileLabelOptional": "Upload corrected file (optional)",
      "bulk.verifyBeforeAdd": "Wait until titles are matched before adding.",
      "bulk.previewTitle": "Review your list",
      "bulk.previewTotal": "Submitted",
      "bulk.previewValid": "Valid rows",
      "bulk.previewDuplicates": "Duplicates",
      "bulk.previewInvalid": "Invalid",
      "bulk.previewPending": "Pending verification",
      "bulk.previewColTitle": "Title",
      "bulk.previewColYear": "Year",
      "bulk.previewColType": "Type",
      "bulk.previewColStatus": "Status",
      "bulk.status.pending": "Pending verification",
      "bulk.status.duplicateList": "Already on your list",
      "bulk.status.duplicateImport": "Duplicate in paste",
      "bulk.status.invalid": "Invalid",
      "bulk.status.processing": "Processing",
      "bulk.status.matching": "Matching…",
      "bulk.status.exact": "Exact match",
      "bulk.status.possible": "Possible match",
      "bulk.status.duplicate": "Duplicate",
      "bulk.status.grouped": "Grouped",
      "bulk.groupedUnderParent": "Will be grouped under {parent}",
      "bulk.willBeAddedInside": "Will be added inside {parent}",
      "bulk.status.notFound": "Not found",
      "bulk.status.failed": "Failed",
      "bulk.status.ready": "Ready to add",
      "bulk.status.added": "Added",
      "bulk.status.cancelled": "Cancelled",
      "bulk.type.movies": "Movie",
      "bulk.type.tvSeries": "TV series",
      "bulk.type.anime": "Anime",
      "bulk.backToPaste": "Back to paste step",
      "bulk.largeImportTitle": "Large import",
      "bulk.largeImportWarning":
        "You pasted {count} titles. They will be reviewed in batches — nothing is added until each title is verified. Continue?",
      "bulk.pasteEmpty": "Paste a list to import.",
      "bulk.unrecognizedFormat":
        "Could not read that list. Use TSV, lines like Title | Year | Type, CSV, or a strict JSON array.",
      "bulk.noneParsed": "No valid rows found in that paste.",
      "bulk.jsonEmpty": "Paste a JSON array to import.",
      "bulk.jsonNotArray": "JSON must be a single array of title objects.",
      "bulk.jsonInvalid":
        "Could not parse that JSON. Check commas, quotes, and braces — truncated or partial JSON is not accepted.",
      "bulk.jsonTruncated":
        "That JSON looks incomplete. Copy the full array from your AI (from [ to ]) and try again.",
      "bulk.jsonCurlyQuotes":
        "Could not parse that JSON. Curly “smart quotes” were detected — re-copy as plain text.",
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
      "auth.storageFull":
        "Device storage is full. Clear this site's browser data or remove old import drafts, then try again.",
      "mobile.notWatched": "Not watched yet",
      "mobile.watchedUnrated": "Watched — not rated yet",
      "mobile.rateTitle": "Rate this title",
      "mobile.editRating": "Edit rating",
      "mobile.close": "Close",
      "detail.close": "Close",
      "detail.watched": "Watched",
      "detail.notWatched": "Not watched yet",
      "detail.watchedUnrated": "Watched — not rated yet",
      "detail.editRating": "Edit rating",
      "detail.rate": "Rate",
      "detail.movieProgressLabel": "Where you stopped watching",
      "detail.movieProgressHint": "Select where you left off",
      "detail.seriesTabsLabel": "Series sections",
      "detail.tabSeasons": "Seasons",
      "detail.tabSpecials": "Specials",
      "detail.tabMovies": "Movies",
      "detail.relatedSpecialsEmpty": "No specials for this title.",
      "detail.relatedMoviesLoading": "Loading related movies…",
      "detail.relatedMoviesEmpty": "no movies related to this title",
      "detail.relatedMovieAdd": "Tap to add to your list",
      "detail.relatedMovieOnList": "Already on your list",
      "detail.addNote": "Add note",
      "detail.editNote": "Edit note",
      "detail.rateTitle": "Rate this title",
      "detail.yourRating": "Your rating",
      "detail.genres": "Genres",
      "detail.openLink": "Open link",
      "detail.markWatched": "Mark watched",
      "detail.markUnwatched": "Mark unwatched",
      "detail.edit": "Edit",
      "detail.move": "Move to another list",
      "detail.delete": "Delete",
      "detail.posterAlt": "Poster for {title}",
      "detail.viewPoster": "View full poster for {title}",
      "detail.posterBroken": "Poster unavailable",
      "detail.openMenu": "More actions",
      "detail.openIMDb": "Open on IMDb",
      "detail.openAniList": "Open on AniList",
      "detail.myRating": "My Rating",
      "detail.myRatingUnrated": "Not rated yet",
      "detail.myRatingPlaceholder": "Mark watched to rate",
      "detail.myRatingNeedComplete": "Mark all episodes as watched to rate",
      "detail.seriesRating": "Series rating",
      "progress.unwatched": "Unwatched",
      "progress.inprogress": "In progress",
      "progress.watched": "Watched",
      "progress.episodes": "{watched}/{total} episodes",
      "progress.markSeasonWatched": "Mark season watched",
      "progress.unmarkSeasonWatched": "Mark season unwatched",
      "progress.seasonPartial": "Partially watched",
      "progress.markAllWatched": "Mark all watched",
      "progress.clearAllWatched": "Unwatch all",
      "progress.loadingEpisodes": "Loading episodes…",
      "progress.loadError": "Could not load episodes.",
      "progress.offline": "You are offline. Episode data is unavailable.",
      "progress.retry": "Retry",
      "progress.specials": "Specials",
      "progress.season": "Season {n}",
      "seasons.sectionTitle": "Seasons",
      "seasons.episodesTitle": "Episodes",
      "seasons.spoilerMode": "Hide episode still",
      "seasons.hideEpisodeRatings": "Hide episode ratings",
      "seasons.hideFiller": "Hide filler episodes",
      "seasons.fillerBadge": "Filler",
      "seasons.jumpToEpisode": "Go to episode",
      "seasons.jumpToEpisodePlaceholder": "Episode #",
      "seasons.jumpToEpisodeGo": "Jump to episode",
      "seasons.scrollToControls": "Back to seasons",
      "seasons.jumpToEpisodeMissing": "No episode {n} in this season",
      "seasons.gapPromptTitle": "Earlier episodes unwatched",
      "seasons.gapPromptMessage": "You haven't marked earlier episodes or seasons as watched. Mark all previous episodes as watched too?",
      "seasons.gapMarkAll": "Mark all watched",
      "seasons.gapNo": "No",
      "seasons.loading": "Loading seasons…",
      "seasons.error": "Could not load season data.",
      "seasons.unavailable": "Season details unavailable.",
      "seasons.noSeasons": "No seasons available.",
      "seasons.offline": "You are offline. Showing cached data.",
      "seasons.offlineNoCache": "You are offline. No season data cached.",
      "seasons.rateLimited": "API rate limited — please try again later.",
      "seasons.invalidId": "No season data available for this title.",
      "seasons.retry": "Retry",
      "seasons.prevSeason": "Previous season",
      "seasons.nextSeason": "Next season",
      "seasons.seasonNum": "Season {n}",
      "seasons.specials": "Specials",
      "seasons.formatMovie": "Movie",
      "seasons.formatOva": "OVA",
      "seasons.formatSpecial": "Special",
      "seasons.episodeCount": "{n} episodes",
      "seasons.episodeCountOne": "1 episode",
      "seasons.watchedProgress": "{watched} / {total} watched",
      "seasons.markSeasonWatched": "Mark {name} as watched",
      "seasons.unmarkSeason": "Mark {name} as unwatched",
      "seasons.seasonComplete": "Complete",
      "seasons.seasonPartial": "Partial",
      "seasons.episodeNum": "Episode {n}",
      "seasons.episodeWatched": "Mark \u201c{title}\u201d as watched",
      "seasons.episodeUnwatch": "Mark \u201c{title}\u201d as unwatched",
      "seasons.epRuntime": "{n} min",
      "seasons.epAiredOn": "Aired {date}",
      "seasons.episodesLoading": "Loading episodes…",
      "seasons.episodesError": "Could not load episodes.",
      "seasons.episodesUnavailable": "Episode details unavailable.",
      "seasons.emptySeason": "No episodes available for this season.",
      "seasons.staleWarning": "Showing cached data — results may be outdated.",
      "seasons.emptyStill": "Episode image unavailable",
      "seasons.episodeRatingSource": "Episode {rating}/10",
      "seasons.episodeRatingYours": "You {rating}/10",
      "seasons.seasonAvgSource": "Season avg {rating}/10",
      "seasons.seasonAvgOmdb": "OMDb avg {rating}/10",
      "seasons.seasonAvgYours": "Your avg {rating}/10",
      "seasons.yourEpisodeRating": "Your episode rating (0-10)",
      "seasons.editEpisodeRating": "Edit",
      "seasons.clearEpisodeRating": "Clear",
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
      "alert.importMergedWithWatch": "Titles were added with ratings and notes where available.",
      "alert.importMergedWithWatchSkips":
        "{added} added with ratings and notes. {skipped} duplicate titles were skipped.",
      "alert.newListCreatedTitle": "New list created",
      "alert.listUpdatedTitle": "List updated",
      "alert.couldNotOpenFile":
        "Could not read that file. Ask your friend to send one downloaded from this app.",
      "alert.couldNotOpenFileTitle": "Could not open file",
      "alert.importMergeConfirm":
        "Add {count} titles from “{listName}” to “{currentName}”? Duplicates will be skipped. Ratings and notes will not be copied.",
      "alert.importMergeWithWatchConfirm":
        "Add {count} titles from “{listName}” to “{currentName}”? Duplicates will be skipped. Matching ratings and notes will be copied too.",
      "alert.importMergeTitle": "Add to current list?",
      "alert.importMergeWithWatchTitle": "Add with ratings and notes?",
      "alert.markUnwatchedConfirm":
        "Mark as unwatched? Your rating and note for this title will be removed.",
      "alert.markUnwatchedTitle": "Remove watch data?",
      "btn.addTitles": "Add titles",
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
      "btn.copyTemplate": "نسخ الرسالة",
      "menu.label": "القائمة",
      "menu.switchList": "تبديل القائمة",
      "menu.manageLists": "إدارة القوائم",
      "menu.share": "مشاركة",
      "menu.changeCode": "تغيير الرمز",
      "menu.deleteAccount": "حذف الحساب",
      "menu.signOut": "تسجيل الخروج",
      "menu.language": "اللغة",
      "menu.theme": "المظهر",
      "credits.menu": "الاعتمادات ومصادر البيانات",
      "credits.title": "الاعتمادات ومصادر البيانات",
      "credits.animeAttribution":
        "تحتوي بيانات هوية الأنمي على معلومات من anime-offline-database من manami-project، متاحة بموجب ODbL 1.0 و DbCL 1.0.",
      "credits.providersHint":
        "قد تأتي بيانات الأفلام والمسلسلات من TMDb و OMDb و TVDB و AniList عند البحث أو إثراء العناوين. قوائمك الخاصة وتقييماتك وتقدم المشاهدة مخزنة بشكل منفصل وليست جزءًا من فهرس الأنمي المرخص.",
      "credits.indexVersion":
        "فهرس الأنمي دون اتصال: إصدار {version} · {count} عنوان · تاريخ المصدر {updated}",
      "credits.archivedNote":
        "مصدر فهرس الأنمي (anime-offline-database) مجموعة بيانات مؤرشفة للقراءة فقط؛ الإصدار المثبت يستمر بالعمل دون تحديثات مستقبلية من المصدر.",
      "credits.close": "إغلاق",
      "theme.dark": "داكن",
      "theme.light": "فاتح",
      "theme.purple": "بنفسجي",
      "theme.brown": "بني",
      "theme.pink": "وردي",
      "theme.modalIntro": "اختر شكل التطبيق. يُحفظ اختيارك على هذا الجهاز.",
      "theme.desc.midnight": "واجهة داكنة نظيفة",
      "theme.desc.light": "أبيض نظيف",
      "theme.desc.purple": "ألوان عميقة زاهية",
      "theme.desc.brown": "لاتيه شوكولاتة كريمي",
      "theme.desc.pink": "وردي مربى الفراولة",
      "lang.en": "English",
      "lang.ar": "العربية",
      "tab.all": "الكل",
      "tab.movies": "أفلام",
      "tab.tvSeries": "مسلسلات",
      "tab.anime": "أنمي",
      "filter.searchPlaceholder": "ابحث في العناوين أو أسماء الممثلين",
      "filter.searchScope": " في قائمتك",
      "filter.searchPlaceholderRich":
        'ابحث في العناوين أو أسماء الممثلين<span class="search__scope-hl"> في قائمتك</span>',
      "filter.searchAria": "ابحث في العناوين أو أسماء الممثلين في قائمتك",
      "filter.searchClear": "مسح البحث",
      "filter.allGenres": "كل التصنيفات",
      "filter.addGenre": "أضف تصنيفاً…",
      "filter.labelGenre": "التصنيف",
      "filter.labelWatched": "الحالة",
      "filter.labelDuration": "المدة",
      "filter.labelEpisodes": "عدد الحلقات",
      "filter.labelSort": "الترتيب",
      "filter.metricAll": "الكل",
      "filter.durationAll": "كل المدد",
      "filter.durationShort": "قصير (أقل من 90 دقيقة)",
      "filter.durationMedium": "متوسط (90-120 دقيقة)",
      "filter.durationLong": "طويل (أكثر من 120 دقيقة)",
      "filter.episodesAll": "كل أعداد الحلقات",
      "filter.episodes1to12": "1-12 حلقة",
      "filter.episodes13to24": "13-24 حلقة",
      "filter.episodes25to50": "25-50 حلقة",
      "filter.episodes51Plus": "51+ حلقة",
      "filter.all": "الكل",
      "filter.watched": "تمت المشاهدة",
      "filter.inProgress": "قيد المشاهدة",
      "filter.unwatched": "لم تُشاهد",
      "filter.byGenre": "تصفية حسب التصنيف (رئيسي أو ثانوي)",
      "filter.byWatched": "تصفية حسب حالة المشاهدة",
      "filter.byRating": "ترتيب حسب",
      "chip.removeFilter": "إزالة تصنيف {genre}",
      "chip.removeGenre": "إزالة {genre}",
      "chip.removeLead": "إزالة {name}",
      "chip.activeFilters": "تصنيفات التصفية النشطة",
      "filter.ratingOptionAll": "الترتيب الافتراضي",
      "filter.ratingOptionAdded": "المضاف مؤخراً",
      "filter.ratingOptionRelease": "تاريخ الإصدار",
      "filter.ratingOptionAge": "التصنيف العمري",
      "filter.ratingOptionDuration": "المدة",
      "filter.ratingOptionEpisodes": "الحلقات",
      "filter.ratingOptionImdb": "تقييمات IMDb",
      "filter.ratingOptionAnilist": "تقييمات AniList",
      "filter.ratingOptionPersonal": "تقييماتي",
      "filter.ratingOptionAddedNewest": "المضاف مؤخراً",
      "filter.ratingOptionAddedOldest": "الأقدم أولاً",
      "filter.ratingOptionImdbBest": "IMDb — الأعلى أولاً",
      "filter.ratingOptionImdbWorst": "IMDb — الأقل أولاً",
      "filter.ratingOptionAnilistBest": "AniList — الأعلى أولاً",
      "filter.ratingOptionAnilistWorst": "AniList — الأقل أولاً",
      "filter.ratingOptionPersonalBest": "تقييمي — الأعلى أولاً",
      "filter.ratingOptionPersonalWorst": "تقييمي — الأقل أولاً",
      "filter.sortDirection": "تبديل اتجاه الترتيب",
      "filter.sortNewestFirst": "الأحدث أولاً",
      "filter.sortOldestFirst": "الأقدم أولاً",
      "filter.sortHighestFirst": "الأعلى أولاً",
      "filter.sortLowestFirst": "الأقل أولاً",
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
      "stats.inProgressWord": "قيد المشاهدة",
      "stats.filterAll": "عرض كل العناوين",
      "stats.filterWatched": "عرض العناوين المشاهدة",
      "stats.filterInProgress": "عرض العناوين قيد المشاهدة",
      "sync.savingShort": "جاري الحفظ…",
      "sync.cloudRestore": "جاري استعادة قائمتك من السحابة",
      "sync.cloudRestoreTitle": "استعادة من السحابة",
      "sync.cloudRestoreFailed": "تعذرت استعادة قائمتك من السحابة. تحقق من الاتصال وحاول مرة أخرى.",
      "sync.failedShort": "فشل النسخ الاحتياطي",
      "sync.savedShort": "تم الحفظ",
      "sync.offlineShort": "غير متصل",
      "sync.retry": "إعادة المحاولة",
      "sync.retryAria": "إعادة محاولة النسخ الاحتياطي",
      "sync.saving": " · جاري الحفظ…",
      "sync.failed": " · فشل الحفظ",
      "sync.saved": " · تم الحفظ",
      "sync.cacheRecoveryTitle": "عناوين مفقودة",
      "sync.cacheRecoveryPrompt":
        "قائمتك تعرض {current} عنواناً، لكن يوجد نسخة احتياطية محلية فيها {cached} ({gap} إضافية). استعادة النسخة الاحتياطية؟ سيستبدل ذلك قائمتك الحالية ويُزامَن مع السحابة.",
      "ptr.refreshing": "جاري التحديث…",
      "ptr.failed": "تعذّر التحديث. تُعرض قائمتك المحفوظة.",
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
      "empty.releaseYearLoading": "جاري تحميل سنوات الإصدار لعناوينك…",
      "empty.releaseYearMissing":
        "سنوات الإصدار غير محفوظة بعد. تُحمّل تلقائياً من IMDb/AniList — انتظر قليلاً أو أضف عبر البحث.",
      "empty.ageRatingLoading": "جاري تحميل التصنيفات العمرية لعناوينك…",
      "empty.ageRatingMissing":
        "التصنيفات العمرية غير محفوظة بعد. تُحمّل تلقائياً من IMDb/AniList — انتظر قليلاً أو أضف عبر البحث.",
      "empty.yearsNeedConfig":
        "سنوات الأفلام تحتاج مفتاح OMDb أو TMDB في config.js على الموقع المنشور. سنوات الأنمي تُحمّل من AniList.",
      "ratings.backfillProgress": "جاري تحميل التقييمات… {done}/{total}",
      "ratings.backfillAnilist": "جاري تحميل تقييمات AniList… {done}/{total}",
      "ratings.backfillImdb": "جاري تحميل تقييمات IMDb… {done}/{total}",
      "ratings.backfillYear": "جاري تحميل سنوات الإصدار… {done}/{total}",
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
      "card.inProgress": "قيد المشاهدة",
      "card.inProgressShort": "جاري",
      "card.watched": "تمت المشاهدة",
      "card.yourRating": "تقييمك",
      "card.rate": "قيّم",
      "card.markWatched": "تمت المشاهدة",
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
      "card.releaseYear": "سنة الإصدار",
      "card.sectionDetails": "التفاصيل",
      "card.sectionTitle": "العنوان",
      "card.sectionGenres": "التصنيف",
      "ageRating.allAges": "لجميع الأعمار",
      "ageRating.kids": "للأطفال",
      "ageRating.ages7": "7+",
      "ageRating.parentalGuidance": "يُفضّل الإشراف",
      "ageRating.ages13": "13+",
      "ageRating.ages14": "14+",
      "ageRating.ages17": "17+",
      "ageRating.adultsOnly": "للبالغين",
      "ageRating.unrated": "غير مصنّف",
      "search.type.all": "الكل",
      "search.type.movie": "أفلام",
      "search.type.series": "مسلسلات",
      "search.type.anime": "أنمي",
      "search.hint":
        "<strong>لم تجد عنوانك؟</strong> اضغط <strong>يدوي</strong> في الأعلى وأضفه بنفسك.",
      "search.label": "ابحث عن أفلام ومسلسلات",
      "search.clearQuery": "مسح البحث",
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
      "search.back": "العودة للبحث",
      "search.chooseGenre": "اختر التصنيف",
      "search.mainGenre": "التصنيف الرئيسي",
      "search.noSummary": "لا يوجد ملخص.",
      "search.alreadyOnList": "في قائمتك",
      "search.pickResult": "{title} — {meta}",
      "search.addResult": "أضف {title}",
      "search.added": "تمت الإضافة",
      "search.addedStatus": "تمت إضافة: {title}",
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
      "add.bulk": "استيراد قائمة",
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
      "share.step1": "ينشئ رابطاً يمكن لأي شخص فتحه.",
      "share.step2": "يسجّلون الدخول بحسابهم لاستيراد عناوينك.",
      "share.note": "رمز الدخول الخاص بك لا يُرسل أبداً في رابط المشاركة.",
      "share.sendTitle": "إرسال قائمتي",
      "share.linkMessage":
        "قائمتي «{name}»{summary} — افتح هذا الرابط لاستيرادها في Our Movie Nights.",
      "share.linkSummaryPart": " — {summary}",
      "share.arrivalTitle": "قائمة مشتركة جاهزة للاستيراد",
      "share.arrivalLoading": "جاري تحميل القائمة المشتركة…",
      "share.arrivalText": "«{name}» تحتوي على {count} عنواناً. اختر كيف تستوردها إلى حسابك.",
      "share.arrivalImport": "مراجعة الاستيراد",
      "share.arrivalDismiss": "إلغاء",
      "share.arrivalExpired": "انتهت صلاحية رابط المشاركة.",
      "share.arrivalInvalid": "رابط المشاركة غير صالح أو لم يعد متاحاً.",
      "pwa.iconNoteTitle": "حدّث أيقونة الشاشة الرئيسية",
      "pwa.iconNoteLead":
        "أضفنا أيقونة التطبيق الصحيحة (روبوت التوست). إذا ما زالت تظهر حرف «O»، حدّث الاختصار مرة واحدة:",
      "pwa.iconNoteStep1": "احذف أيقونة Movie Nights القديمة من الشاشة الرئيسية.",
      "pwa.iconNoteStep2": "افتح الموقع من المتصفح (وليس من الاختصار القديم).",
      "pwa.iconNoteStep3": "أضفه إلى الشاشة الرئيسية مرة أخرى — بنفس طريقة الإضافة الأولى.",
      "pwa.iconNoteDismiss": "تم",
      "share.fileMessage":
        "نسخة احتياطية من قائمتي. افتح Our Movie Nights ← مشاركة ← استيراد قائمة.",
      "manage.title": "إدارة القوائم",
      "manage.create": "إنشاء قائمة جديدة",
      "manage.unnamedList": "قائمة بدون اسم",
      "manage.myList": "قائمتي",
      "manage.signedInNow": "مسجل الدخول الآن",
      "manage.defaultList": "القائمة الافتراضية",
      "manage.assignDefault": "تعيين كقائمة افتراضية",
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
        "اختر طريقة استيراد هذه العناوين إلى حسابك.",
      "import.summaryWithCurrent":
        '«{listName}» فيها {count} عنواناً. أنت على «{currentName}» بـ {currentCount}.',
      "import.summaryEmpty": '«{listName}» فيها {count} عنواناً. قائمتك الحالية فارغة.',
      "import.summaryWithDescription": "الوصف: {description}",
      "import.summarySimpleWithCurrent":
        '«{listName}» فيها {count} عنواناً. استيرادها إلى «{currentName}»؟',
      "import.summarySimpleEmpty": '«{listName}» فيها {count} عنواناً. هل تريد الاستيراد الآن؟',
      "import.newList": "فتح كقائمة جديدة",
      "import.merge": "إضافة لقائمتي الحالية",
      "import.mergeWithWatch": "إضافة للقائمة الحالية مع التقييمات والملاحظات",
      "import.newListFormTitle": "سمّ قائمتك الجديدة",
      "import.newListFormHint":
        "احتفظ بالاسم والوصف المشترَكين أو غيّرهما قبل إنشاء القائمة.",
      "import.newListSubmit": "إنشاء القائمة",
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
      "rating.yourThoughts": "أفكارك",
      "rating.thoughtsSoFar": "أفكارك حتى الآن…",
      "rating.note": "ملاحظة لنفسك",
      "rating.notePlaceholder": "أفكارك",
      "bulk.headline": "أضف قائمة كاملة دفعة واحدة",
      "bulk.step1Title": "انسخ رسالة الذكاء الاصطناعي",
      "bulk.step1Text":
        "اضغط الزر أدناه لنسخ رسالة قصيرة لـ ChatGPT أو Claude أو أي روبوت محادثة. تطلب قائمة بسيطة: العنوان والسنة والنوع (فيلم، مسلسل، أو أنمي).",
      "bulk.step2Title": "الصقها في الذكاء الاصطناعي",
      "bulk.step2Text":
        "الصق الرسالة في المحادثة، ثم أخبره بالعناوين التي تريدها. مثلاً:",
      "bulk.example":
        "«هذه عناويني: Breaking Bad، Interstellar، Attack on Titan…»",
      "bulk.step3Title": "الصق قائمتك أو ارفعها",
      "bulk.step3Text":
        "الصق ما أرسله الذكاء الاصطناعي في المربع أدناه، أو ارفع ملفاً بنفس القائمة تماماً. الملفات النصية فقط (.txt أو .tsv) — وليس PDF أو Word أو Excel أو صور.",
      "bulk.pastePlaceholder": "الصق قائمتك هنا…",
      "bulk.pasteLabel": "القائمة من الذكاء الاصطناعي",
      "bulk.fileLabel": "رفع ملف القائمة (.txt أو .tsv)",
      "bulk.fileHint": "نفس القائمة أعلاه — نص عادي فقط.",
      "bulk.fileWrongType":
        "نوع الملف غير مدعوم. احفظ القائمة كملف .txt أو .tsv (نص عادي)، وليس PDF أو Word أو صورة.",
      "bulk.fileReadFailed": "تعذر قراءة الملف.",
      "bulk.reviewImport": "تحقق من قائمتي",
      "bulk.addVerified": "أضف إلى قائمتي",
      "bulk.verifyBeforeAdd": "انتظر حتى يتم مطابقة العناوين قبل الإضافة.",
      "bulk.previewTitle": "راجع قائمتك",
      "bulk.previewTotal": "المُرسَل",
      "bulk.previewValid": "صفوف صالحة",
      "bulk.previewDuplicates": "مكررات",
      "bulk.previewInvalid": "غير صالح",
      "bulk.previewPending": "بانتظار التحقق",
      "bulk.previewColTitle": "العنوان",
      "bulk.previewColYear": "السنة",
      "bulk.previewColType": "النوع",
      "bulk.previewColStatus": "الحالة",
      "bulk.status.pending": "بانتظار التحقق",
      "bulk.status.duplicateList": "موجود في قائمتك",
      "bulk.status.duplicateImport": "مكرر في اللصق",
      "bulk.status.invalid": "غير صالح",
      "bulk.type.movies": "فيلم",
      "bulk.type.tvSeries": "مسلسل",
      "bulk.type.anime": "أنمي",
      "bulk.backToPaste": "العودة للصق",
      "bulk.copyUnresolved": "نسخ العناوين غير المحلولة",
      "bulk.copyUnresolvedCopied": "تم النسخ!",
      "bulk.copyUnresolvedEmpty": "لا توجد عناوين غير محلولة للنسخ.",
      "bulk.advancedRecovery": "استرداد متقدم",
      "bulk.largeImportTitle": "استيراد كبير",
      "bulk.largeImportWarning":
        "لصقت {count} عنواناً. ستُراجع على دفعات — لا يُضاف شيء حتى يُتحقق من كل عنوان. متابعة؟",
      "bulk.pasteEmpty": "الصق قائمة للاستيراد.",
      "bulk.unrecognizedFormat":
        "تعذر قراءة القائمة. استخدم مصفوفة JSON أو أسطراً مثل: العنوان | السنة | النوع",
      "bulk.noneParsed": "لم يُعثر على صفوف صالحة في اللصق.",
      "bulk.jsonEmpty": "الصق مصفوفة JSON للاستيراد.",
      "bulk.jsonNotArray": "يجب أن يكون JSON مصفوفة واحدة من كائنات العناوين.",
      "bulk.jsonInvalid":
        "تعذر تحليل JSON. تحقق من الفواصل والاقتباسات — لا نقبل JSON مقطوعاً أو جزئياً.",
      "bulk.jsonTruncated":
        "يبدو أن JSON غير مكتمل. انسخ المصفوفة كاملة من [ إلى ] وحاول مجدداً.",
      "bulk.jsonCurlyQuotes":
        "تعذر تحليل JSON. وُجدت علامات اقتباس منحنية — أعد النسخ كنص عادي.",
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
      "auth.storageFull":
        "مساحة التخزين على الجهاز ممتلئة. امسح بيانات الموقع من المتصفح أو أزل مسودات الاستيراد القديمة، ثم حاول مرة أخرى.",
      "mobile.notWatched": "لم تُشاهد بعد",
      "mobile.watchedUnrated": "شُوهدت — لم تُقيَّم بعد",
      "mobile.rateTitle": "قيّم هذا العنوان",
      "mobile.editRating": "تعديل التقييم",
      "mobile.close": "إغلاق",
      "detail.close": "إغلاق",
      "detail.watched": "تمت المشاهدة",
      "detail.notWatched": "لم تُشاهد بعد",
      "detail.watchedUnrated": "مشاهد — لم يُقيَّم بعد",
      "detail.editRating": "تعديل التقييم",
      "detail.rate": "قيِّم",
      "detail.movieProgressLabel": "أين توقفت عن المشاهدة",
      "detail.movieProgressHint": "اختر أين توقفت",
      "detail.seriesTabsLabel": "أقسام المسلسل",
      "detail.tabSeasons": "المواسم",
      "detail.tabSpecials": "حلقات خاصة",
      "detail.tabMovies": "الأفلام",
      "detail.relatedSpecialsEmpty": "لا توجد حلقات خاصة لهذا العنوان.",
      "detail.relatedMoviesLoading": "جاري تحميل الأفلام المرتبطة…",
      "detail.relatedMoviesEmpty": "لا توجد أفلام ذات صلة بهذا العنوان",
      "detail.relatedMovieAdd": "اضغط للإضافة إلى قائمتك",
      "detail.relatedMovieOnList": "موجود في قائمتك",
      "detail.addNote": "إضافة ملاحظة",
      "detail.editNote": "تعديل الملاحظة",
      "detail.rateTitle": "قيِّم هذا العنوان",
      "detail.yourRating": "تقييمك",
      "detail.genres": "التصنيفات",
      "detail.openLink": "فتح الرابط",
      "detail.markWatched": "تمت المشاهدة",
      "detail.markUnwatched": "إلغاء المشاهدة",
      "detail.edit": "تعديل",
      "detail.move": "نقل لقائمة أخرى",
      "detail.delete": "حذف",
      "detail.posterAlt": "ملصق {title}",
      "detail.viewPoster": "عرض الملصق كاملاً لـ {title}",
      "detail.posterBroken": "الملصق غير متاح",
      "detail.openMenu": "مزيد من الإجراءات",
      "detail.openIMDb": "فتح في IMDb",
      "detail.openAniList": "فتح في AniList",
      "detail.myRating": "تقييمي",
      "detail.myRatingUnrated": "لم تُقيَّم بعد",
      "detail.myRatingPlaceholder": "سجّل المشاهدة للتقييم",
      "detail.myRatingNeedComplete": "عيّن كل الحلقات كمشاهَدة للتقييم",
      "detail.seriesRating": "تقييم المسلسل",
      "progress.unwatched": "لم تُشاهد",
      "progress.inprogress": "قيد المشاهدة",
      "progress.watched": "مشاهَد",
      "progress.episodes": "{watched}/{total} حلقة",
      "progress.markSeasonWatched": "تعيين الموسم كمشاهَد",
      "progress.unmarkSeasonWatched": "تعيين الموسم كغير مشاهَد",
      "progress.seasonPartial": "مشاهَد جزئياً",
      "progress.markAllWatched": "تعيين الكل كمشاهَد",
      "progress.clearAllWatched": "إلغاء تحديد الكل",
      "progress.loadingEpisodes": "جارٍ تحميل الحلقات…",
      "progress.loadError": "تعذّر تحميل الحلقات.",
      "progress.offline": "أنت غير متصل بالإنترنت. بيانات الحلقات غير متاحة.",
      "progress.retry": "إعادة المحاولة",
      "progress.specials": "حلقات خاصة",
      "progress.season": "الموسم {n}",
      "seasons.sectionTitle": "المواسم",
      "seasons.episodesTitle": "الحلقات",
      "seasons.spoilerMode": "إخفاء صورة الحلقة",
      "seasons.hideEpisodeRatings": "إخفاء تقييمات الحلقات",
      "seasons.hideFiller": "إخفاء حلقات الفيلر",
      "seasons.fillerBadge": "حشو",
      "seasons.jumpToEpisode": "انتقل إلى الحلقة",
      "seasons.jumpToEpisodePlaceholder": "رقم الحلقة",
      "seasons.jumpToEpisodeGo": "انتقل إلى الحلقة",
      "seasons.scrollToControls": "العودة إلى المواسم",
      "seasons.jumpToEpisodeMissing": "لا توجد حلقة {n} في هذا الموسم",
      "seasons.gapPromptTitle": "حلقات سابقة غير مشاهَدة",
      "seasons.gapPromptMessage": "لم تُعيّن الحلقات أو المواسم الأقدم كمشاهَدة. هل تريد تعيين كل الحلقات السابقة كمشاهَدة أيضاً؟",
      "seasons.gapMarkAll": "تعيين الكل كمشاهَد",
      "seasons.gapNo": "لا",
      "seasons.loading": "جارٍ تحميل المواسم…",
      "seasons.error": "تعذّر تحميل بيانات المواسم.",
      "seasons.unavailable": "تفاصيل المواسم غير متاحة.",
      "seasons.noSeasons": "لا توجد مواسم متاحة.",
      "seasons.offline": "أنت غير متصل. تُعرض البيانات المخزنة مؤقتاً.",
      "seasons.offlineNoCache": "أنت غير متصل. لا توجد بيانات مخزنة.",
      "seasons.rateLimited": "تجاوزت حد الطلبات — يرجى المحاولة لاحقاً.",
      "seasons.invalidId": "لا تتوفر بيانات مواسم لهذا العنوان.",
      "seasons.retry": "إعادة المحاولة",
      "seasons.prevSeason": "الموسم السابق",
      "seasons.nextSeason": "الموسم التالي",
      "seasons.seasonNum": "الموسم {n}",
      "seasons.specials": "حلقات خاصة",
      "seasons.formatMovie": "فيلم",
      "seasons.formatOva": "OVA",
      "seasons.formatSpecial": "خاص",
      "seasons.episodeCount": "{n} حلقة",
      "seasons.episodeCountOne": "حلقة واحدة",
      "seasons.watchedProgress": "{watched} / {total} مشاهَد",
      "seasons.markSeasonWatched": "تعيين {name} كمشاهَد",
      "seasons.unmarkSeason": "تعيين {name} كغير مشاهَد",
      "seasons.seasonComplete": "مكتمل",
      "seasons.seasonPartial": "جزئي",
      "seasons.episodeNum": "الحلقة {n}",
      "seasons.episodeWatched": "تعيين \"{title}\" كمشاهَدة",
      "seasons.episodeUnwatch": "إلغاء مشاهدة \"{title}\"",
      "seasons.epRuntime": "{n} دقيقة",
      "seasons.epAiredOn": "عُرضت في {date}",
      "seasons.episodesLoading": "جارٍ تحميل الحلقات…",
      "seasons.episodesError": "تعذّر تحميل الحلقات.",
      "seasons.episodesUnavailable": "تفاصيل الحلقات غير متاحة.",
      "seasons.emptySeason": "لا توجد حلقات لهذا الموسم.",
      "seasons.staleWarning": "تُعرض بيانات مخزنة — قد تكون قديمة.",
      "seasons.emptyStill": "صورة الحلقة غير متاحة",
      "seasons.episodeRatingSource": "تقييم الحلقة {rating}/10",
      "seasons.episodeRatingYours": "تقييمك {rating}/10",
      "seasons.seasonAvgSource": "متوسط الموسم {rating}/10",
      "seasons.seasonAvgOmdb": "متوسط OMDb ‏{rating}/10",
      "seasons.seasonAvgYours": "متوسطك {rating}/10",
      "seasons.yourEpisodeRating": "تقييمك للحلقة (0-10)",
      "seasons.editEpisodeRating": "تعديل",
      "seasons.clearEpisodeRating": "مسح",
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
      "alert.importMergedWithWatch": "تمت إضافة العناوين مع التقييمات والملاحظات حيث توفرت.",
      "alert.importMergedWithWatchSkips":
        "تمت إضافة {added} مع التقييمات والملاحظات. تم تخطي {skipped} عنواناً مكرراً.",
      "alert.newListCreatedTitle": "قائمة جديدة",
      "alert.listUpdatedTitle": "تم تحديث القائمة",
      "alert.couldNotOpenFile":
        "تعذر قراءة هذا الملف. اطلب من صديقك إرسال ملف منزّل من هذا التطبيق.",
      "alert.couldNotOpenFileTitle": "تعذر فتح الملف",
      "alert.importEmptyList": "لا توجد عناوين في هذا الملف أو الرابط للاستيراد.",
      "alert.importEmptyListTitle": "لا شيء للاستيراد",
      "alert.importMergeConfirm":
        "إضافة {count} عنواناً من «{listName}» إلى «{currentName}»؟ سيتم تخطي المكررات. لن تُنسخ التقييمات والملاحظات.",
      "alert.importMergeWithWatchConfirm":
        "إضافة {count} عنواناً من «{listName}» إلى «{currentName}»؟ سيتم تخطي المكررات. ستُنسخ التقييمات والملاحظات المطابقة أيضاً.",
      "alert.importMergeTitle": "إضافة للقائمة الحالية؟",
      "alert.importMergeWithWatchTitle": "إضافة مع التقييمات والملاحظات؟",
      "alert.markUnwatchedConfirm":
        "تعيين كغير مشاهد؟ سيُحذف تقييمك وملاحظتك لهذا العنوان.",
      "alert.markUnwatchedTitle": "إزالة بيانات المشاهدة؟",
      "btn.addTitles": "إضافة العناوين",
      "btn.addTitles": "إضافة العناوين",
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
    "Device storage is full. Clear this site's browser data or remove old import drafts, then try again.":
      "auth.storageFull",
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
    setText("[data-action='open-credits']", "credits.menu");
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

    setAria("#searchInput", "filter.searchAria");
    setAria("#genreSelect", "filter.byGenre");
    setAria("#watchedFilter", "filter.byWatched");
    setAria("#ratingFilter", "filter.byRating");

    const watched = document.getElementById("watchedFilter");
    if (watched?.options?.length >= 4) {
      watched.options[0].textContent = t("filter.all");
      watched.options[1].textContent = t("filter.watched");
      watched.options[2].textContent = t("filter.inProgress");
      watched.options[3].textContent = t("filter.unwatched");
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
    setText("#searchConfirmAdd", "btn.addTitle");

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
    setText(".share-modal__list li:nth-child(1)", "share.step1");
    setText(".share-modal__list li:nth-child(2)", "share.step2");
    setText(".share-modal__note", "share.note");
    setText("[data-action='share-send']", "share.sendTitle");

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
    setText("#importMergeWatchedBtn", "import.mergeWithWatch");
    setText("#importShareModal .btn--text", "btn.cancel");
    setText("#importNewListModalTitle", "import.newListFormTitle");
    setText("#importNewListModalHint", "import.newListFormHint");
    setText("label:has(#importNewListName) .form-field__label", "create.name");
    setText("label:has(#importNewListDescription) .form-field__label", "create.about");
    setText("#importNewListForm .btn--ghost", "btn.cancel");
    setText("#importNewListSubmit", "import.newListSubmit");

    setText("#bulkAddPanel .modal__footer .btn--ghost", "btn.cancel");
    setText("#bulkAddConfirm", "bulk.reviewImport");
    setText("#bulkImportBack", "bulk.backToPaste");
    setText("#bulkImportResolve", "bulk.resolveRemaining");
    setText("#bulkImportAdvancedSummary", "bulk.advancedRecovery");
    setText("#bulkImportCopyUnresolved", "bulk.copyUnresolved");
    setText("#creditsModalTitle", "credits.title");
    setText("#creditsProvidersHint", "credits.providersHint");
    setText("#creditsArchivedNote", "credits.archivedNote");
    setText("#creditsModal .btn--primary", "credits.close");
    setText("#bulkImportPasteCorrected", "bulk.pasteCorrected");
    setText("#bulkImportFileLabelOptional", "bulk.fileLabelOptional");
    setText("#bulkCorrectedTsvTitle", "bulk.correctedImportTitle");
    setText("#bulkCorrectedTsvHint", "bulk.correctedPasteHint");
    setText("#bulkCorrectedTsvPaste", "bulk.pasteFromClipboard");
    setText("#bulkCorrectedTsvApply", "bulk.applyCorrections");
    setText("#bulkCorrectedTsvModal [data-action='close-bulk-corrected']", "btn.cancel");
    setText("#bulkImportConfirm", "bulk.addVerified");
    setText("#bulkImportPreviewTitle", "bulk.previewTitle");
    setText("#bulkImportColTitle", "bulk.previewColTitle");
    setText("#bulkImportColYear", "bulk.previewColYear");
    setText("#bulkImportColType", "bulk.previewColType");
    setText("#bulkImportColStatus", "bulk.previewColStatus");
    setText("#bulkImportColProvider", "bulk.previewColProvider");
    setText("#bulkImportColReason", "bulk.previewColReason");
    setText("#bulkImportShowAll", "bulk.filter.showAll");
    setText("#bulkFileLabel", "bulk.fileLabel");
    setText("#bulkFileHint", "bulk.fileHint");
    setText("#bulkImportPause", "bulk.pause");
    setText("#bulkImportResume", "bulk.resume");
    setText("#bulkImportRetry", "bulk.retryFailed");
    setText("#bulkImportCancel", "bulk.cancelRemaining");
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

    setAria(".rating-picker__stars", "rating.starsGroup");
    setText(".rating-picker__fine-label", "rating.fineTune");
    setPlaceholder("#ratingNote", "rating.notePlaceholder");
    setText("[data-action='rate-later']", "btn.rateLater");
    if (window.WatchlistApp?.updateRatingModalActions) {
      window.WatchlistApp.updateRatingModalActions();
    } else {
      setText("#ratingForm .btn--primary", "btn.saveRating");
    }

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

    const listName = window.WatchlistAuth?.getListLabel?.();
    const headerTitle = document.getElementById("headerTitle");
    const listTitleDropdownLabel = document.getElementById("listTitleDropdownLabel");
    if (listName) {
      if (headerTitle && !headerTitle.hidden) headerTitle.textContent = listName;
      if (listTitleDropdownLabel) listTitleDropdownLabel.textContent = listName;
      document.title = listName;
    } else {
      document.title = t("app.title");
    }
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t("app.description");
  }

  function applyLanguage(lang) {
    const next = SUPPORTED.includes(lang) ? lang : "en";
    localStorage.setItem(STORAGE_KEY, next);
    const root = document.documentElement;
    root.lang = next;
    root.dir = next === "ar" ? "rtl" : "ltr";
    applyDocument();
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
