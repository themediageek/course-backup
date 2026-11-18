// Every piece of text students read in the course viewer, in one place.

export const copy = {
  skip: 'Skip to content',
  menu: 'Course menu',
  menuButton: 'Menu',
  closeMenu: 'Close',
  nav: { home: 'Home', modules: 'Modules', syllabus: 'Syllabus', assignments: 'Assignments', pages: 'Pages', files: 'Files' },
  searchLabel: 'Search this course',
  searchButton: 'Search',
  themeToDark: 'Switch to dark mode',
  themeToLight: 'Switch to light mode',
  instructor: (name) => `Instructor: ${name}`,
  footer: 'This is a read-only copy of a Canvas course, made so you can keep reading while Canvas is unavailable.',
  datesNote: 'Dates are from the original Canvas course. Your instructor will tell you about any changes.',

  types: { page: 'Page', file: 'File', assignment: 'Assignment', discussion: 'Discussion', quiz: 'Quiz', link: 'Link', tool: 'Tool' },
  due: (date) => `Due ${date}`,
  noDue: 'No due date',
  points: (n) => (n === 1 ? '1 point' : `${Number.isInteger(n) ? n : n.toFixed(2)} points`),
  opens: (date) => `Opens ${date}`,
  newTab: '(opens in a new tab)',

  modulesTitle: 'Modules',
  emptyModule: 'Nothing in this module is included in the backup.',
  noModules: 'This course has no modules in the backup. Use the menu to find its pages.',
  lockedItem: (date) => `This opens on ${date}. Check back then.`,
  lockedModule: (date) => `This module opens on ${date}.`,

  submitHeading: 'How this was turned in on Canvas',
  submitTypes: {
    online_upload: 'File upload', online_text_entry: 'Text entry', online_url: 'Website link',
    media_recording: 'Media recording', student_annotation: 'Annotation', discussion_topic: 'Discussion post',
    online_quiz: 'Quiz', external_tool: 'An outside tool', on_paper: 'On paper', none: 'Nothing to turn in',
  },
  submitNote: 'While Canvas is down, your instructor will tell you how to turn in your work.',
  countsToward: 'Counts toward',
  timeLimitLabel: 'Time limit',
  minutes: (n) => (n === 1 ? '1 minute' : `${n} minutes`),
  attemptsLabel: 'Attempts',
  prevNextLabel: 'Previous and next',
  rubric: 'Rubric',
  rubricCriteria: 'Criteria',
  rubricRatings: 'Ratings',
  rubricPoints: 'Points',
  discussionNote: 'Replies are not available on this site. Your instructor will tell you how to share your response while Canvas is down.',
  quizNote: 'You cannot take this quiz on this site. Your instructor will tell you how it will be handled while Canvas is down.',
  attempts: (n) => (n == null || n < 0 ? 'Unlimited attempts' : n === 1 ? '1 attempt' : `${n} attempts`),
  toolNote: 'This tool opened through Canvas, so it may not work until Canvas is back.',
  toolTry: 'Try opening it',

  fileOpen: 'Open',
  fileDownload: 'Download',
  fileLoading: 'Getting the file ready…',
  fileFailed: 'This file could not be opened. Reload the page and try again.',
  fileKind: (mime) => {
    if (mime === 'application/pdf') return 'PDF';
    if (mime.startsWith('image/')) return 'Image';
    if (mime.startsWith('video/')) return 'Video';
    if (mime.startsWith('audio/')) return 'Audio';
    if (mime.includes('word')) return 'Word document';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return 'PowerPoint';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Spreadsheet';
    return 'File';
  },
  size: (bytes) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`),

  missing: {
    file: 'This file is not included in the backup.',
    item: 'This page is not included in the backup.',
    canvas: 'This link goes to Canvas and may not work right now.',
    media: 'This video or recording was stored in Canvas and is not included in the backup.',
  },
  canvasLabel: '(Canvas link, may not work right now)',

  previous: 'Previous',
  next: 'Next',
  backToModules: 'Back to modules',

  syllabusTitle: 'Syllabus',
  summaryTitle: 'Course summary',
  summaryDate: 'Date',
  summaryDetails: 'Details',
  assignmentsTitle: 'Assignments',
  assignmentsName: 'Name',
  assignmentsType: 'Type',
  assignmentsDue: 'Due',
  assignmentsPoints: 'Points',
  noAssignments: 'No assignments are included in the backup.',
  pagesTitle: 'Pages',
  noPages: 'No pages are included in the backup.',
  filesTitle: 'Files',
  noFiles: 'No files are included in the backup.',
  mainFolder: 'Main folder',

  searchTitle: (q) => `Results for “${q}”`,
  searchCount: (n) => (n === 1 ? '1 result' : `${n} results`),
  searchNone: 'Nothing matched. Try a shorter word or check the spelling.',
  searchEmpty: 'Type a word to search the course.',

  gate: {
    kicker: 'Course backup',
    intro: 'Type the password your instructor sent you.',
    label: 'Password',
    show: 'Show password',
    hide: 'Hide password',
    remember: 'Remember on this device',
    rememberHint: 'Leave this off on a shared or library computer.',
    open: 'Open the course',
    opening: 'Opening the course…',
    empty: 'Type the password first.',
    wrong: 'That password did not work. Check it against your instructor’s message and try again.',
    failed: 'The course could not be opened. Reload the page and try again.',
    missing: 'This course could not be found. Check the link your instructor sent you.',
    forget: 'Forget this course on this device',
  },

  notFound: 'This item is not included in the backup.',
  notFoundHome: 'Go to the course home page',
};
