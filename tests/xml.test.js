import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, kids, kid, txt } from '../app/lib/xml.js';

const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="m1" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"
  xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest">
  <metadata><lomimscc:lom><lomimscc:general>
    <lomimscc:title><lomimscc:string>My Course</lomimscc:string></lomimscc:title>
  </lomimscc:general></lomimscc:lom></metadata>
</manifest>`;

const moduleMeta = `<?xml version="1.0" encoding="UTF-8"?>
<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <module identifier="mod1">
    <title>Module 1</title>
    <items>
      <item identifier="it1">
        <content_type>WikiPage</content_type>
        <due_at/>
      </item>
    </items>
  </module>
  <module identifier="mod2"><title>Module 2</title></module>
</modules>`;

test('kid finds a prefixed LOM element by local name', () => {
  const doc = parseXml(manifest);
  const general = kid(kid(kid(doc.documentElement, 'metadata'), 'lom'), 'general');
  const title = kid(general, 'title');
  assert.ok(title);
  assert.equal(txt(title, 'string'), 'My Course');
});

test('txt reads a child in the Canvas default namespace', () => {
  const doc = parseXml(moduleMeta);
  const mod = kids(doc.documentElement, 'module')[0];
  const item = kid(kid(mod, 'items'), 'item');
  assert.equal(txt(item, 'content_type'), 'WikiPage');
});

test('txt returns null for an empty element and a missing one', () => {
  const doc = parseXml(moduleMeta);
  const item = kid(kid(kids(doc.documentElement, 'module')[0], 'items'), 'item');
  assert.equal(txt(item, 'due_at'), null);
  assert.equal(txt(item, 'unlock_at'), null);
});

test('kids lists every matching child', () => {
  const doc = parseXml(moduleMeta);
  assert.equal(kids(doc.documentElement, 'module').length, 2);
  assert.equal(kids(null, 'module').length, 0);
});
