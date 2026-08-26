from pathlib import Path
p=Path('scripts/bootstrap-business-equity-v2.mjs')
lines=p.read_text().splitlines(True)
out=[]
inside=False
for line in lines:
    if not inside and 'String.raw`' in line:
        inside=True
        # only escape backticks after the String.raw opener on the same line
        head, tail=line.split('String.raw`',1)
        out.append(head+'String.raw`'+tail.replace('`','\\`'))
        continue
    if inside:
        # Outer raw-template closers in this generator are intentionally unindented.
        if line.startswith('`);') or line.startswith('`);\n'):
            inside=False
            out.append(line)
        else:
            out.append(line.replace('`','\\`'))
        continue
    out.append(line)
p.write_text(''.join(out))
