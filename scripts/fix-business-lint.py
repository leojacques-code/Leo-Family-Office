from pathlib import Path
p=Path('src/components/pages/business-equity/business-forms.tsx')
text=p.read_text()
text=text.replace("Date d'effet", "Date d’effet")
text=text.replace("Chiffre d'affaires", "Chiffre d’affaires")
text=text.replace("l'EV", "l’EV")
text=text.replace("d'ouverture", "d’ouverture")
p.write_text(text)
