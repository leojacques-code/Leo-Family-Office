from pathlib import Path
p=Path('scripts/bootstrap-business-equity-v2.mjs')
lines=p.read_text().splitlines(True)
out=[]
inside=False
def escape_generated(s: str) -> str:
    return s.replace('`','\\`').replace('${','\\${')
for line in lines:
    if not inside and 'String.raw`' in line:
        inside=True
        head, tail=line.split('String.raw`',1)
        # Use a normal template after escaping generated backticks/interpolations.
        out.append(head+'`'+escape_generated(tail))
        continue
    if inside:
        if line.startswith('`);') or line.startswith('`);\n'):
            inside=False
            out.append(line)
        else:
            out.append(escape_generated(line))
        continue
    out.append(line)
p.write_text(''.join(out))
