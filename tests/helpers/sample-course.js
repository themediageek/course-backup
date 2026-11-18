// A small made-up Canvas export that uses every content type the site handles.
// Tests use it so they do not depend on private course exports.

const NS = 'xmlns="http://canvas.instructure.com/xsd/cccv1p0"';
const enc = new TextEncoder();

export const QUIZ_SECRET = 'SECRET QUESTION TEXT about the height of spring tides';
export const SAME_PDF = enc.encode('%PDF-1.4 shared reading bytes');

function item(id, type, title, ref, extra = '', indent = 0) {
  return `<item identifier="${id}"><content_type>${type}</content_type><workflow_state>active</workflow_state>
    <title>${title}</title>${ref ? `<identifierref>${ref}</identifierref>` : ''}<position>1</position>
    <new_tab>false</new_tab><indent>${indent}</indent>${extra}</item>`;
}

function page(id, title, body, { state = 'active', front = false } = {}) {
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${title}</title><meta name="identifier" content="${id}"/>
<meta name="editing_roles" content="teachers"/><meta name="workflow_state" content="${state}"/>
${front ? '<meta name="front_page" content="true"/>' : ''}</head><body>${body}</body></html>`;
}

export function sampleFiles(overrides = {}) {
  const files = {
    'course_settings/canvas_export.txt': 'Q: What did the export say? A: Hello.',
    'course_settings/course_settings.xml': `<?xml version="1.0" encoding="UTF-8"?>
<course identifier="c1" ${NS}><title>Ocean Studies 101</title><course_code>OCN 101</course_code>
<default_view>wiki</default_view>
<tab_configuration>[{"id":0},{"id":10},{"id":11,"hidden":true},{"id":2}]</tab_configuration>
<syllabus_course_summary>true</syllabus_course_summary></course>`,
    'course_settings/syllabus.html': '<html><body><p>Read the syllabus first.</p></body></html>',
    'course_settings/module_meta.xml': `<?xml version="1.0" encoding="UTF-8"?>
<modules ${NS}>
  <module identifier="m1"><title>Week 1: Tides</title><workflow_state>active</workflow_state><position>1</position>
    <require_sequential_progress>true</require_sequential_progress><items>
    ${item('i0', 'ContextModuleSubHeader', 'Start here', null)}
    ${item('i1', 'WikiPage', 'Welcome', 'pg1')}
    ${item('i2', 'Attachment', 'Culture reading', 'f1', '', 1)}
    ${item('i3', 'Assignment', 'Tide journal', 'as1')}
    ${item('i4', 'DiscussionTopic', 'Tide talk', 'dt1')}
    ${item('i5', 'Quizzes::Quiz', 'Tide quiz', 'qz1')}
    ${item('i6', 'ExternalUrl', 'NOAA tides', 'i6', '<url>https://tidesandcurrents.noaa.gov/</url>')}
    ${item('i7', 'ContextExternalTool', 'Publisher tool', 'lti1', '<url>https://tool.example.com/launch</url>')}
  </items></module>
  <module identifier="m2"><title>Hidden module</title><workflow_state>unpublished</workflow_state><position>2</position><items>
    ${item('i8', 'WikiPage', 'Answer key', 'pg2')}
  </items></module>
  <module identifier="m3"><title>Week 9: Storms</title><workflow_state>active</workflow_state><position>3</position>
    <unlock_at>2030-01-07T08:00:00</unlock_at><items>
    ${item('i9', 'WikiPage', 'Storm surge', 'pg3')}
  </items></module>
</modules>`,
    'course_settings/files_meta.xml': `<?xml version="1.0" encoding="UTF-8"?>
<fileMeta ${NS}><folders>
  <folder path="Uploaded Media"><hidden>true</hidden></folder>
  <folder path="Instructor"><locked>true</locked></folder>
</folders><files>
  <file identifier="f3"><locked>true</locked></file>
</files></fileMeta>`,
    'course_settings/assignment_groups.xml': `<?xml version="1.0" encoding="UTF-8"?>
<assignmentGroups ${NS}><assignmentGroup identifier="grp1"><title>Journals</title><position>1</position><group_weight>40.0</group_weight></assignmentGroup></assignmentGroups>`,
    'course_settings/rubrics.xml': `<?xml version="1.0" encoding="UTF-8"?>
<rubrics ${NS}><rubric identifier="r1"><title>Journal rubric</title><points_possible>10.0</points_possible><criteria>
  <criterion><criterion_id>c1</criterion_id><points>10.0</points><description>Observations</description>
    <long_description>Records three tide readings.</long_description><ratings>
    <rating><description>Full</description><points>10.0</points><long_description>All three</long_description></rating>
    <rating><description>None</description><points>0.0</points></rating>
  </ratings></criterion></criteria></rubric></rubrics>`,
    'wiki_content/welcome.html': page('pg1', 'Welcome &amp; overview',
      '<p>Welcome.</p><img src="$IMS-CC-FILEBASE$/Uploaded%20Media/photo%20(1).jpg?canvas_download=1" alt="Beach">' +
      '<a href="$IMS-CC-FILEBASE$/O%27Connor%20-%20Culture.pdf?canvas_=1&amp;canvas_qs_wrap=1">Reading</a>' +
      '<a href="$WIKI_REFERENCE$/pages/answer-key">Key</a>' +
      '<a href="https://canvas.example.edu/courses/12/pages/old">Old page</a>', { front: true }),
    'wiki_content/answer-key.html': page('pg2', 'Answer key', '<p>Answers.</p>'),
    'wiki_content/storm-surge.html': page('pg3', 'Storm surge', '<p>Storms.</p>'),
    'wiki_content/draft.html': page('pg4', 'Draft', '<p>Not ready.</p>', { state: 'unpublished' }),
    'wiki_content/extra-reading.html': page('pg5', 'Extra reading', '<p>Optional.</p>'),
    'as1/assignment_settings.xml': `<?xml version="1.0" encoding="UTF-8"?>
<assignment identifier="as1" ${NS}><title>Tide journal</title><due_at>2025-10-17T06:59:00</due_at>
<lock_at>2025-10-20T06:59:00</lock_at><unlock_at/><workflow_state>published</workflow_state>
<assignment_group_identifierref>grp1</assignment_group_identifierref><rubric_identifierref>r1</rubric_identifierref>
<points_possible>10.0</points_possible><grading_type>points</grading_type>
<submission_types>online_upload,online_text_entry</submission_types>
<only_visible_to_overrides>false</only_visible_to_overrides></assignment>`,
    'as1/tide-journal.html': '<html><body><p>Record the tide each morning.</p></body></html>',
    'dt1.xml': `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1"><title>Tide talk</title>
<text texttype="text/html">&lt;p&gt;What surprised you?&lt;/p&gt;</text></topic>`,
    'dtm1.xml': `<?xml version="1.0" encoding="UTF-8"?>
<topicMeta identifier="dtm1" ${NS}><topic_id>dt1</topic_id><title>Tide talk</title><type>topic</type>
<workflow_state>active</workflow_state><assignment identifier="dtA1"><title>Tide talk</title>
<due_at>2025-10-24T06:59:00</due_at><unlock_at/><workflow_state>published</workflow_state>
<assignment_group_identifierref>grp1</assignment_group_identifierref><points_possible>5.0</points_possible>
<grading_type>points</grading_type><submission_types>discussion_topic</submission_types>
<only_visible_to_overrides>true</only_visible_to_overrides></assignment></topicMeta>`,
    'qz1/assessment_meta.xml': `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="qz1" ${NS}><title>Tide quiz</title><description>&lt;p&gt;Ten minutes, one try.&lt;/p&gt;</description>
<due_at>2025-10-31T06:59:00</due_at><unlock_at/><quiz_type>assignment</quiz_type><points_possible>4.0</points_possible>
<time_limit>10</time_limit><allowed_attempts>1</allowed_attempts><available>true</available>
<only_visible_to_overrides>false</only_visible_to_overrides>
<assignment identifier="qzA1"><title>Tide quiz</title><workflow_state>published</workflow_state>
<assignment_group_identifierref>grp1</assignment_group_identifierref><points_possible>4.0</points_possible></assignment></quiz>`,
    'qz1/assessment_qti.xml': `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="qz1" title="Tide quiz"><section ident="root">
<item ident="q1" title="Question"><presentation><material><mattext texttype="text/html">&lt;p&gt;${QUIZ_SECRET}&lt;/p&gt;&lt;img src="$IMS-CC-FILEBASE$/Uploaded%20Media/tide-chart.png"&gt;</mattext></material></presentation></item>
</section></assessment></questestinterop>`,
    'non_cc_assessments/qz1.xml.qti': `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="qz1" title="Tide quiz"><section ident="root">
<item ident="q1"><presentation><material><mattext texttype="text/html">&lt;p&gt;${QUIZ_SECRET}&lt;/p&gt;&lt;img src="$IMS-CC-FILEBASE$/Uploaded%20Media/tide-chart.png"&gt;</mattext></material></presentation></item>
</section></assessment></questestinterop>`,
    'lnk1.xml': `<?xml version="1.0" encoding="UTF-8"?>
<webLink xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imswl_v1p1"><title>NOAA tides</title><url href="https://tidesandcurrents.noaa.gov/"/></webLink>`,
    'lti1.xml': `<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0" xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0">
<blti:title>Publisher tool</blti:title><blti:secure_launch_url>https://tool.example.com/launch</blti:secure_launch_url></cartridge_basiclti_link>`,
    'web_resources/Uploaded Media/photo (1).jpg': enc.encode('JPEGDATA-photo'),
    "web_resources/O'Connor - Culture.pdf": SAME_PDF,
    'web_resources/Copies/Culture copy.pdf': SAME_PDF,
    'web_resources/locked.pdf': enc.encode('%PDF locked'),
    'web_resources/Instructor/key.pdf': enc.encode('%PDF instructor key'),
    'web_resources/assessment_questions/q.png': enc.encode('PNG question'),
    'web_resources/Uploaded Media/tide-chart.png': enc.encode('PNG tide chart'),
  };
  const res = (id, type, href, extra = '') =>
    `<resource identifier="${id}" type="${type}"${href ? ` href="${href}"` : ''}>${href ? `<file href="${href}"/>` : ''}${extra}</resource>`;
  files['imsmanifest.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="man1" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"><metadata/><organizations/><resources>
${res('settings', 'associatedcontent/imscc_xmlv1p1/learning-application-resource', 'course_settings/canvas_export.txt')}
${res('pg1', 'webcontent', 'wiki_content/welcome.html')}
${res('pg2', 'webcontent', 'wiki_content/answer-key.html')}
${res('pg3', 'webcontent', 'wiki_content/storm-surge.html')}
${res('pg4', 'webcontent', 'wiki_content/draft.html')}
${res('pg5', 'webcontent', 'wiki_content/extra-reading.html')}
${res('f1', 'webcontent', "web_resources/O'Connor - Culture.pdf")}
${res('f2', 'webcontent', 'web_resources/Uploaded Media/photo (1).jpg')}
${res('f3', 'webcontent', 'web_resources/locked.pdf')}
${res('f4', 'webcontent', 'web_resources/Instructor/key.pdf')}
${res('f5', 'webcontent', 'web_resources/assessment_questions/q.png')}
${res('f6', 'webcontent', 'web_resources/Uploaded Media/tide-chart.png')}
${res('f7', 'webcontent', 'web_resources/Copies/Culture copy.pdf')}
${res('as1', 'associatedcontent/imscc_xmlv1p1/learning-application-resource', 'as1/tide-journal.html', '<file href="as1/assignment_settings.xml"/>')}
${res('dt1', 'imsdt_xmlv1p1', null, '<file href="dt1.xml"/><dependency identifierref="dtm1"/>')}
${res('dtm1', 'associatedcontent/imscc_xmlv1p1/learning-application-resource', 'dtm1.xml')}
${res('qz1', 'imsqti_xmlv1p2/imscc_xmlv1p1/assessment', null, '<file href="qz1/assessment_qti.xml"/><dependency identifierref="qzm1"/>')}
${res('qzm1', 'associatedcontent/imscc_xmlv1p1/learning-application-resource', 'qz1/assessment_meta.xml', '<file href="non_cc_assessments/qz1.xml.qti"/>')}
${res('lnk1', 'imswl_xmlv1p1', null, '<file href="lnk1.xml"/>')}
${res('lti1', 'imsbasiclti_xmlv1p0', null, '<file href="lti1.xml"/>')}
</resources></manifest>`;
  return { ...files, ...overrides };
}
