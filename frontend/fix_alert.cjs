const fs = require('fs');
let blockStr = fs.readFileSync('src/components/BlockEditorModal.jsx', 'utf8');
blockStr = blockStr.replace(/<Alert=\{\((.*?)\)\}/g, '<Alert title={($1)}');
blockStr = blockStr.replace(/<Alert=\{(.*?)\}/g, '<Alert title={$1}');
blockStr = blockStr.replace(/<Alert=\"(.*?)\"/g, '<Alert title=\"$1\"');
blockStr = blockStr.replace(/<Alert=/g, '<Alert title=');
fs.writeFileSync('src/components/BlockEditorModal.jsx', blockStr);
