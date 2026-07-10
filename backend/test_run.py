import sqlite3, json, os
from pathlib import Path
from main import slugify, RUNNER_TEMPLATE, indent_code, get_project_dir

db = sqlite3.connect('data/pyflow.db')
db.row_factory = sqlite3.Row
old_row = db.execute('SELECT name, project_id FROM workflow WHERE id=?', ('662f1407-d11f-4310-afb8-be46eac2109f',)).fetchone()
old_name = old_row['name']
proj_id = old_row['project_id']
proj_dir = get_project_dir(proj_id)
new_dir = proj_dir / f'wf_{slugify(old_name)}'

graph_json = '{\"nodes\": [{\"id\": \"block1\", \"data\": {\"type\": \"python\", \"label\": \"My Code\", \"code\": \"print(1)\"}}]}'
graph = json.loads(graph_json)
new_dir.mkdir(parents=True, exist_ok=True)

for node in graph.get('nodes', []):
    if node.get('data', {}).get('type', 'python') == 'python':
        bid = node['id']
        label = node['data'].get('label', bid)
        code = node['data'].get('code', '')
        block_path = new_dir / f'{slugify(label)}.py'
        print(f'Writing to {block_path}')
        wrapped = RUNNER_TEMPLATE.format(workflow_id='123', block_id=bid, user_code=indent_code(code))
        block_path.write_text(wrapped, encoding='utf-8')

print('Success')
print(list(new_dir.iterdir()))
