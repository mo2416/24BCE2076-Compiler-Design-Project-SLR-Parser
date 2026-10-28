/*
 * bundle.js — writes ../SLR-Parser.html: final/index.html with every
 * <script src="../js/…"> inlined, so the app is one file that opens offline.
 * Run:  node source/bundle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const here = __dirname;
let html = fs.readFileSync(path.join(here, 'final', 'index.html'), 'utf8');

html = html.replace(/<script src="\.\.\/js\/([\w-]+\.js)"><\/script>/g, function (_, file) {
  const code = fs.readFileSync(path.join(here, 'js', file), 'utf8');
  return '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
if (/<script src=/.test(html)) throw new Error('a script was not inlined');

/* Keep the side gutters clear of phone notches when hosted full-bleed. */
html = html.replace('</style>',
  'body{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}\n' +
  '.bar{top:env(safe-area-inset-top,0px);margin:0 calc(-1*max(16px,env(safe-area-inset-left,0px)))}\n' +
  '.sheet,.inputs{width:min(920px,100%)}\n</style>');

const out = path.join(here, '..', 'SLR-Parser.html');
fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
