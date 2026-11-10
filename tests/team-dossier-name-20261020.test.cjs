'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const read = (rel) => readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('team API only projects safe names after authorizing registration membership', () => {
  const source = read('functions/competition.js');
  const start = source.indexOf('handlers.getCompetitionContext = async');
  const next = source.indexOf('handlers.getParticipantWorkspace = async', start);
  const block = source.slice(start, next);
  assert.ok(start > 0 && next > start);
  assert.ok(block.indexOf('registrationAccess(tx, registrationId, user)') < block.indexOf('teamMembers = registration.package'), 'must authorize before reading names');
  assert.match(block, /registration\.userName/);
  assert.match(block, /memberProfile\.participantName \|\| memberProfile\.legalName \|\| memberProfile\.displayName/);
  assert.match(block, /members: teamMembers/);
  assert.doesNotMatch(block, /email: memberProfile\.|phone: memberProfile\./);
});

test('roster uses accessible names and never prints a UID as human-readable text', () => {
  const js = read('public/competition-participant.js');
  assert.match(js, /membersByUid\.get\(uid\)\?\.name/);
  assert.match(js, /const displayName = membersByUid\.get\(uid\)\?\.name \|\| \(leaderMember \? data\.registration\.userName/);
  assert.match(js, /<strong>\$\{esc\(displayName\)\}<\/strong>/);
  assert.doesNotMatch(js, /<span class="cf-meta">\$\{esc\(uid\)\}<\/span>/);
  assert.match(js, /\$\{esc\(uid\)\}/); // allowed internally for editor permission payload
});

test('team invite retains internal ID for backend compatibility but displays a friendly reference', () => {
  const html = read('public/submission.html');
  const js = read('public/competition-participant.js');
  assert.match(html, /id="team-reference"/);
  assert.match(html, /id="team-copy-id"/);
  assert.match(html, /id="team-code-manual"[^>]*readonly hidden/);
  assert.match(js, /\$\('#team-reference'\)\.textContent = data\.registration\.referenceNumber/);
  assert.match(js, /navigator\.clipboard\.writeText\(registrationId\)/);
  assert.match(js, /\$\('#team-invitation'\)\.hidden = !data\.leader/);
  assert.match(read('functions/competition.js'), /handlers\.joinTeam = async/);
});

test('roster paper styles preserve hidden state and compact mobile layout', () => {
  const css = read('public/team-workspace-paper.css');
  assert.match(css, /\.team-paper \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.team-paper-members\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(read('public/submission.html'), /href="team-workspace-paper\.css/);
});

test('runtime team roster renders human names, pending slots and private editor controls', () => {
  const vm = require('node:vm');
  const script = read('public/competition-participant.js');
  const start = script.indexOf('    if (data.team) {');
  const end = script.indexOf("    $('#result-section').hidden", start);
  assert.ok(start >= 0 && end > start);
  const fragment = script.slice(start, end);
  const nodes = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {innerHTML:'',textContent:'',hidden:false,value:''});
    return nodes.get(selector);
  };
  const data = {
    leader:true,
    registration:{teamName:'Nova Builders',referenceNumber:'ECF-TEST-TEAM',memberCount:3,userName:'Fikri Anwar'},
    team:{leaderUid:'uid-ketua',memberUids:['uid-ketua','uid-anggota'],editorUids:['uid-anggota'],members:[
      {uid:'uid-ketua',name:'Fikri Anwar',role:'leader'},
      {uid:'uid-anggota',name:'Rina Putri',role:'member'}
    ]}
  };
  const escape = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  vm.runInNewContext(fragment, {$,data,user:{uid:'uid-ketua'},frozen:false,esc:escape,registrationId:'internal__uid-ketua__team__wave-01'});
  assert.equal($('#team-display-name').textContent,'Nova Builders');
  assert.equal($('#team-reference').textContent,'ECF-TEST-TEAM');
  assert.equal($('#team-member-count').textContent,'2 dari 3 terhubung');
  assert.match($('#team-members').innerHTML,/Fikri Anwar/);
  assert.match($('#team-members').innerHTML,/Rina Putri/);
  assert.match($('#team-members').innerHTML,/Belum terhubung/);
  assert.doesNotMatch($('#team-members').innerHTML,/<strong>uid-ketua<\/strong>|<strong>uid-anggota<\/strong>/);
  assert.match($('#team-members').innerHTML,/data-editor="uid-anggota"/);
  assert.equal($('#team-invitation').hidden,false);

  data.leader=false;
  vm.runInNewContext(fragment, {$,data,user:{uid:'uid-anggota'},frozen:true,esc:escape,registrationId:'internal__uid-ketua__team__wave-01'});
  assert.equal($('#team-invitation').hidden,true);
  assert.doesNotMatch($('#team-members').innerHTML,/data-editor=/);
});
