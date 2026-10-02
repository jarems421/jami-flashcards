"""
GCSE marking benchmark corpus: real students' answers, marked by the board.

Every GCSE figure Jami had came from Medly's mock questions, which name no
board, so nothing could say how marking holds up on AQA against Pearson
Edexcel against OCR, or on History against Maths. Each board publishes
examiner-marked student work to show teachers how its schemes are applied:
Pearson's exemplar booklets, AQA's answers-and-commentaries, OCR's exemplar
candidate work and examiners' reports. This reads them into corpus records
tagged with board, course and subject.

The answer is the scan the board printed, extracted as the embedded image
itself rather than a render of the page around it: the examiner's mark and
commentary are typed beside the scan, and a render would hand them to the
marker. Each image is written to artifacts/corpus/gcse-board-exemplars/ for a
person to look at, because a scan carrying examiner ticks is an answer key.

Measure-only: board exemplar material may be used to evaluate privately but
not redistributed, which is why it lives under the gitignored artifacts/.

    pip install pymupdf
    python scripts/eval/build-gcse-board-corpus.py
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

DATASETS = Path(r"C:\Users\jarem\jami-datasets\gcse-board-benchmark")
OUT = Path(__file__).resolve().parents[2] / "artifacts" / "corpus"
IMAGES = OUT / "gcse-board-exemplars"
SOURCE_ID = "gcse-board-exemplars"

# Scans smaller than this are navigation buttons, logos and ticks in a key.
MIN_IMAGE_WIDTH = 250
MIN_IMAGE_HEIGHT = 60

FURNITURE = re.compile(
    r"^(Pearson Edexcel Level 1/Level 2 GCSE.*|Exemplification of the .*|.*Pearson Education \d{4}|"
    r"DO NOT WRITE ?IN ?THIS ?AREA.*|Skip to Main Contents|\[back to Contents page\]|\d{1,3})$"
)


@dataclass
class Record:
    id: str
    board: str
    course: str
    subject: str
    regime: str
    question_id: str
    prompt: str
    scheme: str
    max_marks: int
    awarded: int
    images: list[str]
    commentary: str = ""
    level_detail: str = ""
    # Typed answers: AQA reproduces the student's words rather than a scan.
    text_answer: str = ""
    # The question as printed, where the source gives it as a picture.
    question_images: list[str] = field(default_factory=list)
    # The question refers to a source or figure the document does not print.
    stimulus_missing: bool = False
    # Each assessment objective's mark, where the examiner gave them separately.
    objective_marks: list[dict] | None = None
    issues: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "sourceId": SOURCE_ID,
            "level": "gcse",
            "levelDetail": self.level_detail or None,
            "board": self.board,
            "course": self.course,
            "subject": self.subject,
            "regime": self.regime,
            "questionId": self.question_id,
            "questionPrompt": self.prompt,
            "answer": {"kind": "text", "text": self.text_answer}
            if self.text_answer
            else {"kind": "image", "paths": self.images},
            "stimulusMissing": self.stimulus_missing or None,
            "questionImages": self.question_images or None,
            "assessmentObjectiveMarks": [self.objective_marks] if self.objective_marks else None,
            "humanMarks": [self.awarded],
            "maxMarks": self.max_marks,
            "markScheme": self.scheme,
            "examinerCommentary": self.commentary or None,
        }


def clean(text: str) -> str:
    lines = [line.strip() for line in text.replace("\u00a0", " ").splitlines()]
    kept = [line for line in lines if line and not FURNITURE.match(line)]
    return "\n".join(kept)


def answer_images(page: pymupdf.Page, top: float = -1, bottom: float = 1e9) -> list[tuple[int, pymupdf.Rect]]:
    """The student's scans on a page, top to bottom, inside a vertical band."""
    found: dict[int, pymupdf.Rect] = {}
    for info in page.get_images(full=True):
        xref, width, height = info[0], info[2], info[3]
        if width < MIN_IMAGE_WIDTH or height < MIN_IMAGE_HEIGHT:
            continue
        for rect in page.get_image_rects(xref):
            if top <= rect.y0 < bottom and rect.width > 150:
                found[xref] = rect
    return sorted(found.items(), key=lambda item: item[1].y0)


def save_image(doc: pymupdf.Document, xref: int, name: str) -> str:
    IMAGES.mkdir(parents=True, exist_ok=True)
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha >= 4:  # CMYK
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    # Keep handwriting legible without sending print-resolution scans.
    while pix.width > 1600:
        pix.shrink(1)
    target = IMAGES / f"{name}.png"
    pix.save(str(target))
    return str(target)


# ---------------------------------------------------------------------------
# Pearson Edexcel maths exemplar booklets
#
# Every booklet runs question page(s), mark scheme page(s), then one page per
# student response headed "Student response A" (or "Question 7 - Response A")
# with the examiner's award printed as "3/3" on a line of its own.
# ---------------------------------------------------------------------------

RESPONSE = re.compile(r"(?:Student response|Response)\s+([A-H])\b", re.I)
AWARD = re.compile(r"^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*$", re.M)
EXEMPLAR_Q = re.compile(r"(?:Paper\s+(\d[FH]))?\s*\W*\s*Exemplar question\s+(\d+)", re.I)
TIER_Q = re.compile(r"(?:Higher|Foundation)(?:/Foundation)? tier(?: Paper (\d))?\s*Question\s+(\d+)", re.I)
PLAIN_Q = re.compile(r"^Question\s+(\d+)(?:\s*-\s*Response [A-H])?$", re.M)
SCHEME = re.compile(r"Mark Scheme|Question\s*\n?\s*Answer\s*\n?\s*Mark", re.I)


TOTAL = re.compile(r"\(Total for Question\s+(\d+)\s+is\s+(\d+)\s+marks?\)", re.I)


def pearson_maths(file: Path, tag: str, tier: str, paper_hint: str = "") -> list[Record]:
    """
    Segmented by the booklet's own order, not its running header.

    Each exemplar runs question pages, then scheme pages, then responses, and
    a question page after a response page starts the next exemplar. The
    running header cannot be trusted for this: in the November 2017 booklet it
    already names question 9 on the last page of question 8, which put one
    question's prompt under another's scheme.
    """
    doc = pymupdf.open(file)
    records: list[Record] = []
    prompt: list[str] = []
    scheme: list[str] = []
    paper = paper_hint
    question = None
    total = None  # (exam question number, its tariff)
    seen_response = False
    part = 1

    for index, page in enumerate(doc):
        raw = page.get_text()
        text = clean(raw)
        header = EXEMPLAR_Q.search(raw)
        if header and header.group(1):
            paper = header.group(1).upper()
        responses = list(RESPONSE.finditer(raw))
        # A heading of its own: examiner comments say "the mark scheme" in prose.
        is_scheme = bool(re.search(r"^\s*Mark scheme\s*$", raw, re.M | re.I)) and not responses

        if not responses:
            # The body's own heading, not the running header "Paper 1H - ...".
            heading = re.search(r"^\s*Exemplar question\s+(\d+)\b", raw, re.M | re.I)
            key = f"{paper or tier}-q{heading.group(1)}" if heading else None
            if key and key != question:
                prompt, scheme, total, seen_response, part = [], [], None, False, 1
                question = key
            elif seen_response and question is not None:
                # The next part of the same question, exemplified on its own:
                # its scheme follows the last part's responses directly. The
                # prompt carries over; the part's tariff is the award's.
                scheme, total, seen_response, part = [], None, False, part + 1
            elif question is None:
                continue
            # A page can carry the question and, below it, the scheme.
            split = re.split(r"^\s*Mark scheme\s*$", text, maxsplit=1, flags=re.M | re.I)
            above, below = (split[0], split[1]) if len(split) == 2 else ((text, "") if not is_scheme else ("", text))
            found = TOTAL.search(above)
            if found:
                total = (int(found.group(1)), int(found.group(2)))
            above = re.sub(r"^Mean score:.*$", "", above, flags=re.M)
            above = re.sub(r"Examiner Comments?[\s\S]*", "", above, flags=re.I)
            above = re.sub(r"^Paper \d[FH]\W+Exemplar question \d+\s*$", "", above, flags=re.M | re.I)
            if above.strip() and not seen_response and part == 1:
                prompt.append(above.strip())
            if below.strip():
                scheme.append(re.sub(r"^Mean score:.*$", "", below, flags=re.M).strip())
            continue
        seen_response = True

        # Locate each response header on the page so scans can be attributed.
        blocks = page.get_text("blocks")
        heads = []
        for block in blocks:
            match = RESPONSE.search(block[4])
            if match:
                heads.append((block[1], match.group(1).upper()))
        heads.sort()
        awards = [(int(a), int(b)) for a, b in AWARD.findall(raw)]
        for position, (y, letter) in enumerate(heads):
            bottom = heads[position + 1][0] if position + 1 < len(heads) else 1e9
            scans = answer_images(page, y - 5, bottom)
            record_id = f"pearson:maths:{tag}:{question}{f'-part{part}' if part > 1 else ''}:{letter.lower()}"
            issues = []
            if len(heads) != len(awards) and len(awards) != 1:
                issues.append(f"page {index + 1}: {len(heads)} responses, {len(awards)} awards")
            if not scans:
                issues.append(f"page {index + 1}: no scan")
            award = awards[position] if position < len(awards) else (awards[0] if awards else (None, None))
            if award[0] is None or award[0] > award[1]:
                issues.append(f"page {index + 1}: unreadable award {award}")
            elif total and award[1] != total[1]:
                # The response shows only some parts of the question, and the
                # prompt and scheme describe all of them.
                issues.append(f"page {index + 1}: award out of {award[1]}, question worth {total[1]}")
            if not scheme:
                issues.append(f"page {index + 1}: no scheme for {question}")
            images = [save_image(doc, xref, f"{record_id.replace(':', '_')}_{n}") for n, (xref, _) in enumerate(scans)] if not issues else []
            comment = text.split("Examiner comment", 1)[-1] if "Examiner comment" in text else ""
            records.append(
                Record(
                    id=record_id,
                    board="Pearson Edexcel",
                    course="GCSE Mathematics",
                    subject="maths",
                    regime="additive",
                    question_id=f"{tag}:{question}{f'-part{part}' if part > 1 else ''}",
                    # Where the booklet printed the question as a picture there
                    # is no text to take, and the scan is of the student's own
                    # exam page, question included.
                    prompt="\n\n".join(p for p in prompt if p)
                    or "The question is printed at the top of the student's scanned exam page.",
                    scheme="\n\n".join(scheme),
                    max_marks=award[1] or 0,
                    awarded=award[0] or 0,
                    images=images,
                    commentary=comment.strip(),
                    level_detail=f"{tier} tier",
                    issues=issues,
                )
            )
    return records


SECTION = re.compile(r"Question\s+(\d+)\s*-\s*(Question|Mark Scheme|Examiner Comments|Performance|Response ([A-H]))\s*$", re.M)


def pearson_web_export(file: Path, tag: str, tier: str, paper: str) -> list[Record]:
    """
    The 2022 booklets are exported from Pearson's results website, and label
    every page: "Question 29 - Question", "- Mark Scheme", "- Response A".
    Sections are read by those labels; an exemplar the export gave no scheme is
    skipped, because the inline "P1 for ..." under each response is the
    examiner's verdict on that response, not the scheme.
    """
    doc = pymupdf.open(file)
    sections: dict[tuple[str, str], list[tuple[int, str]]] = {}
    for index, page in enumerate(doc):
        raw = page.get_text()
        found = list(SECTION.finditer(raw))
        for position, match in enumerate(found):
            end = found[position + 1].start() if position + 1 < len(found) else len(raw)
            sections.setdefault((match.group(1), match.group(2)), []).append((index, raw[match.end():end]))

    def body(text: str) -> str:
        lines = [line.strip() for line in text.splitlines()]
        return "\n".join(line for line in lines if line and not re.fullmatch(r"[A-C]|Q\d+|\d{1,2}|Question:", line))

    records: list[Record] = []
    for (number, kind), parts in sorted(sections.items(), key=lambda item: (int(item[0][0]), item[0][1])):
        if not kind.startswith("Response"):
            continue
        letter = kind.split()[-1]
        index, text = parts[0]
        question = f"{paper}-q{number}"
        record_id = f"pearson:maths:{tag}:{question}:{letter.lower()}"
        prompt = "\n".join(body(t) for _, t in sections.get((number, "Question"), []))
        scheme = "\n".join(body(t) for _, t in sections.get((number, "Mark Scheme"), []))
        award = AWARD.search(text)
        issues = []
        if not scheme:
            issues.append("no scheme")
        if not award or int(award.group(1)) > int(award.group(2)):
            issues.append("unreadable award")
        page = doc[index]
        heads = sorted(
            (block[1], RESPONSE.search(block[4]).group(1)) for block in page.get_text("blocks") if RESPONSE.search(block[4])
        )
        top = next((y for y, l in heads if l == letter), 0)
        below = [y for y, _ in heads if y > top]
        scans = answer_images(page, top - 5, below[0] if below else 1e9)
        if not scans:
            issues.append("no scan")
        images = [save_image(doc, xref, f"{record_id.replace(':', '_')}_{n}") for n, (xref, _) in enumerate(scans)] if not issues else []
        records.append(
            Record(
                id=record_id,
                board="Pearson Edexcel",
                course="GCSE Mathematics",
                subject="maths",
                regime="additive",
                question_id=f"{tag}:{question}",
                prompt=prompt or "The question is printed at the top of the student's scanned exam page.",
                scheme=scheme,
                max_marks=int(award.group(2)) if award else 0,
                awarded=int(award.group(1)) if award else 0,
                images=images,
                commentary=body(text[award.end():]) if award else "",
                level_detail=f"{tier} tier",
                issues=issues,
            )
        )
    return records


# ---------------------------------------------------------------------------
# AQA answers and commentaries
#
# AQA reproduces each answer as typed text "exactly as written by the
# student", so these records are text answers. Three layouts.
# ---------------------------------------------------------------------------

AQA_FURNITURE = re.compile(
    r"^\s*(\S?\s*20\d\d AQA.*|.*\d+ of \d+\s*$|AQA Education \(AQA\) is a registered charity.*|England and Wales \(number.*|"
    r"GCSE (GEOGRAPHY|HISTORY).*(RESPONSES|COMMENTARIES)\s*$|Write your annotations|in this column, in these|boxes)\s*$"
)


def pdf_text(file: Path, layout: bool = True) -> str:
    import subprocess

    out = subprocess.run(
        ["pdftotext", *(["-layout"] if layout else []), str(file), "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    ).stdout
    lines = [line.rstrip() for line in out.replace("\f", "\n").splitlines()]
    return "\n".join(line for line in lines if not AQA_FURNITURE.match(line))


def squash(text: str) -> str:
    """Layout text to readable text: one space between words, blank lines kept as paragraph breaks."""
    paragraphs = re.split(r"\n\s*\n", text.strip())
    return "\n\n".join(re.sub(r"\s+", " ", p).strip() for p in paragraphs if p.strip())


TARIFF = re.compile(r"\[(\d+)\s*marks?\]", re.I)

DASH = r"\s*[–\-−�]\s*"
ROW_TITLED = re.compile(rf"^\s*Level\s+(\d)\s*:?\s*(.*?)\s+(\d{{1,2}}){DASH}(\d{{1,2}})\s*$")
ROW_TABLE = re.compile(rf"^\s*(\d)\s*(?:\(([A-Za-z]+)\))?\s+(\d{{1,2}}){DASH}(\d{{1,2}})\b\s*(.*)$")
ROW_ZERO = re.compile(r"^\s*(\d)\s+0\b")
ROW_RANGE_ONLY = re.compile(rf"^\s*(\d{{1,2}}){DASH}(\d{{1,2}})\b\s*(.*)$")
JUNK = re.compile(
    r"^(Descriptor|Target:.*|AO\d: \d+ marks\.|You (may|must).*|Level\s+Marks?.*|No rewardable material\.?|"
    r"\[?AO\d\]?;?|Analysis .*\[AO\d\];?|Knowledge .*\[AO\d\]\.?|"
    # A short bullet with no sentence in it is a stimulus point ("the stocks").
    r"[•�]\s*[^.]{0,40})$",
    re.I,
)


def with_levels(raw: str, max_marks: int) -> str:
    """
    The scheme as published, followed by its level table restated one level
    per line in the notation the evaluation adapter reads.

    Every board prints its levels as a table -- "3 (Detailed) 5-6 AO3 ...",
    "Level 4: Complex evaluation ... 7-8" -- and a table read as text runs its
    columns together. Unread, the adapter fell back to bands it derived itself
    and told the marker the source "published a reference answer but no band
    descriptors", which is false for every one of these and was measured that
    way on the first 61 AQA answers. The restatement is checked: levels must
    run from 1, be contiguous, and end at the tariff, or nothing is added and
    the record keeps the raw text alone.
    """
    lines = raw.splitlines()
    rows: list[dict] = []
    pending_zero: int | None = None
    for index, line in enumerate(lines):
        titled = ROW_TITLED.match(line)
        table = ROW_TABLE.match(line)
        if titled:
            rows.append({"level": int(titled.group(1)), "min": int(titled.group(3)), "max": int(titled.group(4)), "text": [titled.group(2)], "line": index})
            continue
        if table and int(table.group(3)) > 0:
            rows.append({"level": int(table.group(1)), "min": int(table.group(3)), "max": int(table.group(4)), "text": [table.group(5)], "line": index})
            continue
        zero = ROW_ZERO.match(line)
        if zero:
            pending_zero = int(zero.group(1))
            continue
        ranged = ROW_RANGE_ONLY.match(line)
        if ranged and pending_zero is not None:
            # Pearson prints level 1 as "1  0" with its range on the next line.
            rows.append({"level": pending_zero, "min": int(ranged.group(1)), "max": int(ranged.group(2)), "text": [ranged.group(3)], "line": index})
            pending_zero = None
            continue
        if rows and line.strip() and not JUNK.match(line.strip()):
            rows[-1]["text"].append(line.strip())

    # Adjacent rows one level apart form a table, in either order: AQA prints
    # Level 4 first, Pearson Level 1. One scheme may hold several tables.
    runs: list[list[dict]] = []
    for row in rows:
        last = runs[-1] if runs else None
        if last and abs(row["level"] - last[-1]["level"]) in (1, 2) and row["level"] not in {r["level"] for r in last}:
            last.append(row)
        else:
            runs.append([row])
    runs = [sorted(run, key=lambda r: r["level"]) for run in runs]
    # A middle row the text layer dropped ("2 (Clear) 4-6" between levels 3
    # and 1) is restored when its neighbours leave exactly its range.
    for run in runs:
        for position in range(len(run) - 1, 0, -1):
            below, above = run[position - 1], run[position]
            if above["level"] - below["level"] == 2 and above["min"] - below["max"] >= 2:
                run.insert(position, {
                    "level": below["level"] + 1, "min": below["max"] + 1, "max": above["min"] - 1,
                    "text": [], "line": below["line"],
                })
    def checked(candidates: list[list[dict]]) -> list[list[dict]]:
        return [
            run
            for run in candidates
            if len(run) >= 2
            and all(run[i + 1]["min"] == run[i]["max"] + 1 for i in range(len(run) - 1))
            and run[-1]["max"] == max_marks
            and run[0]["min"] == 1
        ]

    valid = checked(runs)
    if not valid:
        # Some tables put the level ("2 (Clear)") and its range ("3-4") on
        # separate lines; pair each level with the next range below it. The
        # descriptor columns are too jumbled there to attribute.
        paired: list[dict] = []
        waiting: list[int] = []
        header = next((i for i, line in enumerate(lines) if re.search(r"Level\s+Marks?\b", line)), len(lines))
        for index, line in enumerate(lines):
            if index <= header:
                continue
            # A lone level, "2 (Clear)", or "1   AO2 ..." with the descriptor beside it.
            level = re.match(r"^\s*([1-5])\s*(?:\(([A-Za-z]+)\))?\s*$|^\s*([1-5])\s*(?:\(([A-Za-z]+)\)|\s{3,}AO\d)", line)
            if level:
                waiting.append(int(level.group(1) or level.group(3)))
            span = re.match(rf"^\s*(?:\d\s*(?:\([A-Za-z]+\))?\s+)?(\d{{1,2}}){DASH}(\d{{1,2}})\b", line)
            if span and waiting and int(span.group(1)) > 0:
                paired.append({"level": waiting.pop(0), "min": int(span.group(1)), "max": int(span.group(2)), "text": [], "line": index})
        valid = checked([sorted(paired, key=lambda r: r["level"])]) if paired else []
        for run in valid:
            for row in run:
                row["text"] = [f"the Level {row['level']} descriptor in the published scheme above"]
    if not valid:
        return squash(raw)
    run = valid[-1]
    # Pearson prints the table's level column first and the descriptors after
    # it, several strands per level, so a row's own text is column fragments
    # and the last row collects every descriptor. Those cannot be attributed
    # to levels from text alone. The ranges can, so they are restated with a
    # pointer to the published descriptors, which the marker reads above.
    for row in run:
        row["text"] = [t for t in row["text"] if t.strip() and not JUNK.match(t.strip())]
    if all(not "".join(r["text"]).strip(" .") for r in run[:-1]):
        for row in run:
            row["text"] = [f"the Level {row['level']} descriptor in the published scheme above"]
    levels = "\n".join(
        f"Level {row['level']}: {re.sub(r'\s+', ' ', ' '.join(row['text'])).strip(' •�') or 'see the scheme above'} ({row['min']}-{row['max']} marks)"
        for row in run
    )
    return f"{squash(raw)}\n\nLevels, as the table above sets them out:\n{levels}"
STIMULUS = re.compile(r"\b(Source|Interpretation|Figure|Fig\.)\s+[A-Z0-9]", re.I)


def aqa_scheme_by_question(ms_file: Path) -> dict[str, str]:
    """AQA scheme rows start "01   3 <guidance>": question, then part."""
    text = pdf_text(ms_file)
    # Indented by up to eight: a row set five in ran one question's scheme on
    # into the next and made a two-mark point question look levels-marked.
    rows = list(re.finditer(r"(?m)^\s{0,8}(\d{2})\s{2,}(\d{1,2})\s", text))
    out: dict[str, str] = {}
    for position, row in enumerate(rows):
        end = rows[position + 1].start() if position + 1 < len(rows) else len(text)
        key = f"{int(row.group(1)):02d}.{int(row.group(2))}"
        out[key] = out.get(key, "") + text[row.start() : end] + "\n"
    return out


def aqa_commentary(file: Path, ms_file: Path, tag: str, course: str, subject: str) -> list[Record]:
    """
    Geography papers 1 and 3: "Question 01.3", the question, then per student
    "Response ... Commentary ... Level 2, 3 marks". No scheme in the document;
    it is cut from the series' published scheme by question number.
    """
    text = pdf_text(file)
    schemes = aqa_scheme_by_question(ms_file)
    records: list[Record] = []
    blocks = list(re.finditer(r"(?m)^\s*Questions?\s+(\d{1,2}\.\d{1,2})(\s+and\s+[\d.]+)?\s*$", text))
    for position, block in enumerate(blocks):
        body = text[block.end() : blocks[position + 1].start() if position + 1 < len(blocks) else len(text)]
        number = block.group(1)
        key = f"{int(number.split('.')[0]):02d}.{int(number.split('.')[1])}"
        first = re.search(r"(?m)^\s*Student [A-Z]\s*$", body)
        if not first:
            continue
        prompt = squash(body[: first.start()])
        tariff = TARIFF.search(prompt)
        students = list(re.finditer(r"(?m)^\s*Student ([A-Z])\s*$", body))
        for index, student in enumerate(students):
            chunk = body[student.end() : students[index + 1].start() if index + 1 < len(students) else len(body)]
            parts = re.split(r"(?m)^\s*Commentary\s*$", chunk, maxsplit=1)
            answer = re.sub(r"(?m)^\s*Response\s*$", "", parts[0])
            commentary = parts[1] if len(parts) == 2 else ""
            awards = re.findall(r"(?m)^\s*(?:Level \d,\s*)?(\d{1,2}) marks?\s*$", commentary)
            issues = []
            if block.group(2):
                issues.append("two questions marked together")
            if not tariff:
                issues.append("no tariff")
            if len(awards) != 1:
                issues.append(f"{len(awards)} awards")
            if key not in schemes:
                issues.append(f"no scheme for {key}")
            else:
                # The pack's question must be the scheme's: a series' variant
                # paper reuses numbers for other questions (04.1 was a pie
                # chart in the scheme and a pattern in the pack), and one
                # question carried 4 marks in the pack and 6 in the scheme.
                first_line = schemes[key].strip().splitlines()[0]
                total = re.search(r"\s(\d{1,2})\s*$", first_line)
                opening = [w for w in re.findall(r"[a-z]+", prompt.lower())][:5]
                scheme_words = re.findall(r"[a-z]+", squash(schemes[key])[:300].lower())
                if " ".join(opening) not in " ".join(scheme_words):
                    issues.append(f"question {key} in the pack is not the scheme's")
                if tariff and total and int(total.group(1)) != int(tariff.group(1)):
                    issues.append(f"tariff {tariff.group(1)} in the pack, {total.group(1)} in the scheme")
            records.append(
                Record(
                    id=f"aqa:{subject}:{tag}:q{number}:{student.group(1).lower()}{index + 1}",
                    board="AQA",
                    course=course,
                    subject=subject,
                    # Levels-marked when the scheme carries a level table.
                    regime="banded" if re.search(r"Level\s+Marks\s+Description", schemes.get(key, "")) else "additive",
                    question_id=f"{tag}:q{number}",
                    prompt=prompt,
                    scheme=with_levels(schemes.get(key, ""), int(tariff.group(1)) if tariff else 0),
                    max_marks=int(tariff.group(1)) if tariff else 0,
                    awarded=int(awards[0]) if len(awards) == 1 else 0,
                    images=[],
                    text_answer=squash(answer),
                    commentary=squash(commentary),
                    stimulus_missing=bool(STIMULUS.search(prompt)),
                    issues=issues,
                )
            )
    return records


def aqa_specimen_responses(file: Path, tag: str, course: str, subject: str) -> list[Record]:
    """
    Geography paper 2 (specimen sets): question, scheme and "Student response
    N" in one document. The examiner's note is indented under each response
    and ends "L3 = 6 marks".
    """
    text = pdf_text(file)
    records: list[Record] = []
    blocks = list(re.finditer(r"(?m)^\s*Specimen paper \(set (\d)\), question (\d+\.\d+)\s*$", text))
    for position, block in enumerate(blocks):
        body = text[block.end() : blocks[position + 1].start() if position + 1 < len(blocks) else len(text)]
        number = f"set{block.group(1)}-q{block.group(2)}"
        sections = re.split(r"(?m)^\s*(Question|Mark scheme|Student responses)\s*$", body)
        named = {sections[i]: sections[i + 1] for i in range(1, len(sections) - 1, 2)}
        prompt = squash(named.get("Question", ""))
        tariff = TARIFF.search(prompt)
        scheme = with_levels(named.get("Mark scheme", ""), int(tariff.group(1)) if tariff else 0)
        responses_text = named.get("Student responses", "")
        responses = list(re.finditer(r"(?m)^\s*Student response (\d+)\s*$", responses_text))
        for index, response in enumerate(responses):
            chunk = responses_text[response.end() : responses[index + 1].start() if index + 1 < len(responses) else len(responses_text)]
            award = re.search(r"(?m)^\s*L\d\s*=\s*(\d{1,2})\s*marks?", chunk)
            # The student's text sits at the margin; the examiner's note is indented.
            lines = chunk.splitlines()
            answer = "\n".join(line for line in lines if line and not line.startswith("   "))
            note = "\n".join(line for line in lines if line.startswith("   "))
            issues = []
            if not award:
                issues.append("no award")
            if not tariff:
                issues.append("no tariff")
            if not scheme:
                issues.append("no scheme")
            records.append(
                Record(
                    id=f"aqa:{subject}:{tag}:{number}:r{response.group(1)}",
                    board="AQA",
                    course=course,
                    subject=subject,
                    regime="banded",
                    question_id=f"{tag}:{number}",
                    prompt=prompt,
                    scheme=scheme,
                    max_marks=int(tariff.group(1)) if tariff else 0,
                    awarded=int(award.group(1)) if award else 0,
                    images=[],
                    text_answer=squash(answer),
                    commentary=squash(note),
                    stimulus_missing=bool(STIMULUS.search(prompt)),
                    level_detail="Specimen paper",
                    issues=issues,
                )
            )
    return records


LEVEL_RANGE = re.compile(r"Level\s+(\d):[^\n]*?(\d{1,2})\s*\S\s*(\d{1,2})\s*$", re.M)


def level_position_mark(commentary: str, ranges: dict[int, tuple[int, int]]) -> tuple[int | None, str]:
    """
    The exact mark an AQA commentary pins, or None.

    AQA states the level and a position in words. Only wordings that leave one
    mark are taken: the top or bottom of any level, and "towards" either end
    only of a two-mark level, where there is nothing else it could mean.
    """
    found = re.search(r"credited\s+(?:at|in)\s+level\s+(\d)|remains? in level\s+(\d)|at level\s+(\d)", commentary, re.I)
    stated = re.search(r"This is a Level (\d) response", commentary)
    level = int(next(g for g in (found.groups() if found else ()) if g) if found else stated.group(1)) if (found or stated) else None
    if level is None or level not in ranges:
        return None, "no level"
    low, high = ranges[level]
    words = re.sub(r"\s+", " ", commentary.lower())
    top = re.search(r"(higher|highest|top) mark|at the top of the level|top of the level", words)
    bottom = re.search(r"(lower|lowest|bottom) mark|at the bottom of the level|bottom of the level", words)
    towards_top = "towards the top" in words
    towards_bottom = "towards the bottom" in words
    if top and not bottom:
        return high, ""
    if bottom and not top:
        return low, ""
    if high - low == 1 and towards_top:
        return high, ""
    if high - low == 1 and towards_bottom:
        return low, ""
    if low == high:
        return low, ""
    return None, f"position within level {level} ({low}-{high}) not stated exactly"


def aqa_levels_typed(file: Path, tag: str, course: str, subject: str) -> list[Record]:
    """
    History answers and commentaries: question, scheme with levels, then
    "Response A ... This is a Level 3 response" and a commentary that places
    it within the level in words.
    """
    text = pdf_text(file)
    records: list[Record] = []
    blocks = list(re.finditer(r"(?m)^Question (\d+)\s*$", text))
    for position, block in enumerate(blocks):
        body = text[block.end() : blocks[position + 1].start() if position + 1 < len(blocks) else len(text)]
        number = block.group(1)
        head, _, rest = body.partition("Mark scheme")
        scheme_text, _, responses_text = rest.partition("Student responses")
        prompt = squash(head)
        tariff = TARIFF.search(prompt)
        scheme = with_levels(scheme_text, int(tariff.group(1)) if tariff else 0)
        ranges = {int(m.group(1)): (int(m.group(2)), int(m.group(3))) for m in LEVEL_RANGE.finditer(scheme_text)}
        responses = list(re.finditer(r"(?m)^Response ([A-Z])\s*$", responses_text))
        for index, response in enumerate(responses):
            chunk = responses_text[response.end() : responses[index + 1].start() if index + 1 < len(responses) else len(responses_text)]
            answer, _, verdict = chunk.partition("This is a Level")
            verdict = "This is a Level" + verdict
            mark, why = level_position_mark(verdict, ranges)
            issues = [why] if mark is None else []
            if not tariff:
                issues.append("no tariff")
            records.append(
                Record(
                    id=f"aqa:{subject}:{tag}:q{number}:{response.group(1).lower()}",
                    board="AQA",
                    course=course,
                    subject=subject,
                    regime="banded",
                    question_id=f"{tag}:q{number}",
                    prompt=prompt,
                    scheme=scheme,
                    max_marks=int(tariff.group(1)) if tariff else 0,
                    awarded=mark or 0,
                    images=[],
                    text_answer=squash(answer),
                    commentary=squash(verdict),
                    stimulus_missing=bool(STIMULUS.search(prompt)),
                    issues=issues,
                )
            )
    return records


# ---------------------------------------------------------------------------
# OCR maths exemplar candidate work
#
# The booklets carry the student's scan and the examiner's award and nothing
# else: no tariff, no scheme. Both come from the series' question paper and
# mark scheme, read by position on the page because their text layers run the
# columns together. Each part's tariff is read from both documents and a part
# where they disagree is dropped, since that can only be a parsing error.
# ---------------------------------------------------------------------------

ROMAN = {"i", "ii", "iii", "iv", "v", "vi"}
PartKey = tuple  # (question number, part letter or "", sub-part numeral or "")


def ocr_question_paper(file: Path) -> dict[PartKey, dict]:
    """Every part's prompt and tariff, from the margin labels and the "[n]" at the right."""
    doc = pymupdf.open(file)
    stems: dict[PartKey, list[str]] = {}
    tariffs: dict[PartKey, int] = {}
    q, part, sub = 0, "", ""
    for page in list(doc)[1:]:
        words = sorted(page.get_text("words"), key=lambda w: (round(w[1] / 3), w[0]))
        for w in words:
            x, y, token = w[0], w[1], w[4]
            if y > page.rect.height - 70 or y < 40:
                continue  # running header, page number, copyright
            if 44 <= x <= 58 and re.fullmatch(r"\d{1,2}", token) and int(token) == q + 1:
                q, part, sub = int(token), "", ""
                continue
            if 66 <= x <= 80 and re.fullmatch(r"\(([a-h])\)", token):
                part, sub = token[1], ""
                continue
            if 84 <= x <= 100 and re.fullmatch(r"\((i{1,3}|iv|v|vi)\)", token):
                sub = token[1:-1]
                continue
            if x > 500 and re.fullmatch(r"\[(\d{1,2})\]", token):
                tariffs[(q, part, sub)] = int(token[1:-1])
                continue
            if q and x < 500 and not re.fullmatch(r"\.{4,}.*|[.…]+", token):
                stems.setdefault((q, part, sub), []).append(token)
    parts = {}
    for key, tariff in tariffs.items():
        number, letter, numeral = key
        prompt = [
            " ".join(stems.get((number, "", ""), [])),
            f"({letter}) " + " ".join(stems.get((number, letter, ""), [])) if letter else "",
            f"({numeral}) " + " ".join(stems.get(key, [])) if numeral else "",
        ]
        parts[key] = {"prompt": "\n\n".join(p for p in prompt if p.strip()), "tariff": tariff}
    return parts


def ocr_mark_scheme(file: Path) -> dict[PartKey, dict]:
    """Each row's guidance and its Marks figure, by the table's column positions."""
    doc = pymupdf.open(file)
    rows: dict[PartKey, dict] = {}
    q, part, sub = 0, "", ""
    started = False
    for page in doc:
        words = page.get_text("words")
        header = {w[4]: w[0] for w in words if w[4] in ("Question", "Answer", "Marks", "Part")}
        # The table's own header row marks where the scheme starts; some
        # schemes print no "MARK SCHEME" heading above it.
        if {"Question", "Answer", "Marks"} <= header.keys():
            started = True
        if not started or "Answer" not in header or "Marks" not in header:
            continue
        # Labels sit under "Question"; answer text starts well left of its own header.
        label_x = header["Question"] + 58 if "Question" in header else header["Answer"] - 75
        answer_x, marks_x, part_x = label_x + 8, header["Marks"], header.get("Part", header["Marks"] + 170)
        header_y = max(w[1] for w in words if w[4] == "Answer")
        lines: dict[int, list] = {}
        for w in words:
            if w[1] <= header_y + 2 or w[1] > page.rect.height - 40:
                continue
            lines.setdefault(round(w[1] / 4), []).append(w)
        for _, line in sorted(lines.items()):
            line.sort(key=lambda w: w[0])
            labels = [w for w in line if w[0] < answer_x - 8]
            for w in labels:
                token = w[4].strip("()")
                if re.fullmatch(r"\d{1,2}", token) and w[0] < label_x - 40:
                    q, part, sub = int(token), "", ""
                elif re.fullmatch(r"[a-h]", token):
                    part, sub = token, ""
                elif token in ROMAN:
                    sub = token
            key = (q, part, sub)
            if not q:
                continue
            row = rows.setdefault(key, {"text": [], "marks": None})
            if labels and row["marks"] is None:
                for index, w in enumerate(line):
                    following = line[index + 1][4] if index + 1 < len(line) else ""
                    if marks_x + 5 <= w[0] <= part_x - 20 and re.fullmatch(r"\d{1,2}", w[4]) and not following.startswith("AO"):
                        row["marks"] = int(w[4])
                        break
            row["text"].append(" ".join(w[4] for w in line if w[0] >= answer_x - 8 and not (w[0] < part_x - 20 and w[0] > marks_x - 20 and w[4].startswith("AO"))))
    return {key: {"text": "\n".join(t for t in value["text"] if t.strip()), "marks": value["marks"]} for key, value in rows.items()}


OCR_LABEL = re.compile(r"Question\s+(\d{1,2})((?:\([a-h]\))?)((?:\((?:i{1,3}|iv|v|vi)\))?)")
OCR_AWARD = re.compile(r"(?:Exemplar\s+(\d)\s*\S\s*)?Mark\(s\):\s*(\d{1,2})")


def ocr_maths_exemplars(ecw: Path, qp: Path, ms: Path, tag: str, tier: str) -> list[Record]:
    paper = ocr_question_paper(qp)
    scheme = ocr_mark_scheme(ms)
    doc = pymupdf.open(ecw)
    records: list[Record] = []
    current: PartKey | None = None
    question_crops: list[int] = []
    seen_award = False
    for index, page in enumerate(doc):
        raw = page.get_text()
        label = OCR_LABEL.search(raw)
        if label:
            current = (int(label.group(1)), label.group(2).strip("()"), label.group(3).strip("()"))
            question_crops = []
            seen_award = False
        if current is None:
            continue
        # The student's scan is inset; crops of the printed question run full width.
        everything = answer_images(page)
        scans = [(xref, rect) for xref, rect in everything if rect.x0 > 45]
        awards = list(OCR_AWARD.finditer(raw))
        if not seen_award:
            question_crops += [xref for xref, rect in everything if rect.x0 <= 45]
        if not awards:
            continue
        seen_award = True
        if len(awards) != 1:
            continue
        number, letter, numeral = current
        name = f"{number}{f'({letter})' if letter else ''}{f'({numeral})' if numeral else ''}"
        exemplar = awards[0].group(1) or "1"
        record_id = f"ocr:maths:{tag}:q{name}:e{exemplar}"
        part = paper.get(current)
        row = scheme.get(current)
        # A scheme row can cover a whole question when its parts share guidance.
        if row is None and not numeral:
            row = scheme.get((number, letter, ""))
        issues = []
        if not part:
            issues.append(f"no question-paper part {current}")
        if not row or not row["text"]:
            issues.append(f"no scheme row {current}")
        if part and row and row["marks"] is not None and row["marks"] != part["tariff"]:
            issues.append(f"tariff {part['tariff']} on the paper, {row['marks']} in the scheme")
        awarded = int(awards[0].group(2))
        if part and awarded > part["tariff"]:
            issues.append(f"award {awarded} over tariff {part['tariff']}")
        if not scans:
            issues.append(f"page {index + 1}: no scan")
        stem = record_id.replace(":", "_").replace("(", "").replace(")", "")
        images = [save_image(doc, xref, f"{stem}_{n}") for n, (xref, _) in enumerate(scans)] if not issues else []
        printed = [save_image(doc, xref, f"{stem}_question_{n}") for n, xref in enumerate(question_crops)] if not issues else []
        records.append(
            Record(
                id=record_id,
                board="OCR",
                course="GCSE Mathematics",
                subject="maths",
                regime="additive",
                question_id=f"{tag}:q{name}",
                prompt=(part["prompt"] + f"\n\nMark part {name} only.") if part else "",
                scheme=row["text"] if row else "",
                max_marks=part["tariff"] if part else 0,
                awarded=awarded,
                images=images,
                question_images=printed,
                commentary=raw.split("Examiner commentary", 1)[-1].strip() if "Examiner commentary" in raw else "",
                level_detail=f"{tier} tier",
                issues=issues,
            )
        )
    return records


# ---------------------------------------------------------------------------
# Pearson Edexcel History exemplar packs (2022 layout)
#
# Each option's question is printed as picture crops above "Student A", each
# answer runs on across pages as scans, and "Examiner commentary" closes it
# with "Level 3 - 7 marks". Read in page order as a stream of events, because
# an answer's last scan often shares a page with its commentary.
# ---------------------------------------------------------------------------


def pearson_scheme_blocks(ms_file: Path) -> dict[str, str]:
    """Pearson History scheme: each block opens "Question <text>" and names its number below, "1 (b)"."""
    text = pdf_text(ms_file)
    starts = [m for m in re.finditer(r"(?m)^Question\s+(?!Paper)", text)]
    blocks: dict[str, str] = {}
    for position, start in enumerate(starts):
        block = text[start.start() : starts[position + 1].start() if position + 1 < len(starts) else len(text)]
        number = re.search(r"(?m)^\s*(\d)\s*\(([a-z])\)(?:\s*\((i+)\))?|^\s*(\d)\s{3,}", block[:600])
        if not number:
            continue
        key = f"{number.group(1)}{number.group(2) or ''}{number.group(3) or ''}" if number.group(1) else number.group(4)
        blocks[key] = blocks.get(key, "") + block
    return blocks


def pearson_stream(
    doc: pymupdf.Document,
    *,
    section: re.Pattern,
    label: re.Pattern,
    commentary: str,
    option: re.Pattern | None = None,
) -> list[dict]:
    """
    A Pearson exemplar pack read in page order as a stream of events.

    A question heading opens a section; under an option heading, the pictures
    before the first label are the printed question; a label ("Student A",
    "Script 2") opens an answer and every scan after it belongs to that answer,
    across page breaks, until the examiner's commentary closes it. Read as a
    stream because an answer's last scan often shares a page with its
    commentary, and its first with the question.
    """
    responses: list[dict] = []
    state = {"section": None, "option": None, "crops": [], "collecting": False, "current": None}

    def close(text: str, page_index: int):
        if state["current"] is not None:
            responses.append({**state["current"], "commentary": text, "page": page_index})
            state["current"] = None

    for index, page in enumerate(doc):
        events = []
        blocks = page.get_text("blocks")
        for block in blocks:
            text = block[4].strip()
            heading = section.match(text)
            if heading and block[1] < 200:
                events.append((block[1], "section", next(g for g in heading.groups() if g)))
            elif option and option.match(text):
                events.append((block[1], "option", option.match(text).group(1)))
            elif label.match(text):
                match = label.match(text)
                events.append((block[1], "label", (match.group(1), match.group(2) if match.lastindex and match.lastindex > 1 else None)))
            elif text.startswith(commentary):
                below = " ".join(b[4] for b in blocks if b[1] >= block[1])
                events.append((block[1], "commentary", below))
        for xref, rect in answer_images(page):
            if rect.x0 > 380 and rect.y1 < 100:
                continue  # the pack's logo
            events.append((rect.y0, "image", xref))
        for _, kind, value in sorted(events, key=lambda e: (e[0], e[1] != "image")):
            if kind == "section":
                close("", index)
                state["section"] = value
                if not option:
                    state["crops"], state["collecting"] = [], True
            elif kind == "option":
                close("", index)
                state["option"], state["crops"], state["collecting"] = value, [], True
            elif kind == "label":
                close("", index)
                letter, named = value
                state["collecting"] = False
                state["current"] = {
                    "section": state["section"],
                    "option": named or state["option"],
                    "letter": letter,
                    "scans": [],
                    "question": list(state["crops"]),
                }
            elif kind == "image":
                if state["current"] is not None:
                    state["current"]["scans"].append(value)
                elif state["collecting"]:
                    state["crops"].append(value)
            elif kind == "commentary":
                close(value, index)
    return responses


AWARD_TEXT = re.compile(r"(?:Level\s+(\d)\s*\S\s*)?(\d{1,2})\s+marks?")


def pearson_history_2022(pack: Path, tag: str, sections: dict, options: dict[str, Path | None]) -> list[Record]:
    """
    `sections` maps a section heading's question ("2a", "5") to (scheme keys,
    tariff); `options` maps the option name the pack prints to its scheme file.
    """
    doc = pymupdf.open(pack)
    schemes = {name: pearson_scheme_blocks(path) if path else {} for name, path in options.items()}
    records: list[Record] = []
    for response in pearson_stream(
        doc,
        # "Questions 5 and 6" first, or its "a" is read as a part letter.
        section=re.compile(r"Questions\s+(\d)\s+and\s+\d|Questions?\s+(\d\s*(?:\([a-z]\))?)"),
        option=re.compile(r"Question \(([^)]+)\)"),
        label=re.compile(r"Student ([A-Z])\b(?:\s*\(([^)]+)\)?)?"),
        commentary="Examiner commentary",
    ):
        section = re.sub(r"[\s()]", "", response["section"] or "")
        named = (response["option"] or "").strip()
        option = next((o for o in options if named and o.lower().startswith(named.lower()[:12])), named)
        found = AWARD_TEXT.search(response["commentary"])
        keys, tariff = sections.get(section, ((), 0))
        # An essay choice carries both questions' schemes, which share one
        # level table: restated once, at the end, so the bands are not doubled.
        raws = [schemes[option][key] for key in keys if schemes.get(option, {}).get(key)]
        restated = with_levels(raws[0], tariff) if raws else ""
        block = restated[restated.find("\n\nLevels, as") :] if "\n\nLevels, as" in restated else ""
        scheme = ("\n\n".join(squash(raw) for raw in raws) + block).strip()
        record_id = f"pearson:history:{tag}:q{section}:{option.split()[0].lower() if option else 'none'}:{response['letter'].lower()}"
        issues = []
        if not found:
            issues.append(f"page {response['page'] + 1}: no award")
        if not scheme:
            issues.append(f"no scheme for {option} q{section}")
        if not response["scans"]:
            issues.append("no scan")
        if found and int(found.group(2)) > tariff:
            issues.append(f"award {found.group(2)} over tariff {tariff}")
        stem = record_id.replace(":", "_")
        records.append(
            Record(
                id=record_id,
                board="Pearson Edexcel",
                course="GCSE History",
                subject="history",
                # "Follow up a source" is point-marked; the rest by level.
                regime="additive" if section == "2b" else "banded",
                question_id=f"{tag}:q{section}:{option}",
                prompt=(
                    "The question is printed above as it appears on the exam paper."
                    if response["question"]
                    else "The question is printed at the top of the student's scanned exam page."
                )
                + (" The student answered one of the two essay questions in the scheme; the printed question says which." if len(keys) > 1 else ""),
                scheme=scheme,
                max_marks=tariff,
                awarded=int(found.group(2)) if found else 0,
                images=[save_image(doc, xref, f"{stem}_{n}") for n, xref in enumerate(response["scans"])] if not issues else [],
                question_images=[save_image(doc, xref, f"{stem}_question_{n}") for n, xref in enumerate(response["question"])] if not issues else [],
                commentary=squash(response["commentary"]),
                stimulus_missing=bool(re.search(r"Source", scheme[:400])),
                issues=issues,
            )
        )
    return records


PEARSON_HISTORY_MS = DATASETS / "pearson/history-ms"


def pearson_levels_notation(text: str) -> str:
    """
    Pearson's level tables ("Level 2 3–4  • descriptor") in the notation the
    evaluation adapter reads ("Level 2: descriptor (3-4 marks)"), so a band
    is marked against the board's own descriptor rather than an estimated one.
    """
    out: list[str] = []
    level: list[str] | None = None
    for line in text.splitlines():
        match = re.match(r"^\s*Level\s+(\d)\s+(\d{1,2})\s*[–\-−�]\s*(\d{1,2})\s*(.*)$", line)
        if match:
            if level:
                out.append(level[0].replace("{d}", " ".join(level[1:]).strip()))
            level = [f"Level {match.group(1)}: {{d}} ({match.group(2)}-{match.group(3)} marks)", match.group(4).strip(" •�")]
        elif level is not None and line.strip() and not re.match(r"^\s*(\d+\s*$|Level\s+Mark|AO\d)", line):
            level.append(line.strip(" •�"))
        elif level is not None and re.match(r"^\s*AO\d", line):
            out.append(level[0].replace("{d}", " ".join(level[1:]).strip()))
            level = None
            out.append(line)
        else:
            if level is None:
                out.append(line)
    if level:
        out.append(level[0].replace("{d}", " ".join(level[1:]).strip()))
    return "\n".join(out)


def pearson_english_2023() -> list[Record]:
    """
    English Language Paper 1, June 2023: real scripts with the examiner's mark.
    Prompts come from the question paper, which prints the extracts for
    questions 2 and 3; questions 1 and 4 read lines of the insert, which is not
    public, so they are flagged as missing their stimulus. The writing tasks
    are marked on two assessment objectives and recorded as such.
    """
    root = DATASETS / "pearson/english-2023"
    doc = pymupdf.open(DATASETS / "pearson/english-lang-p1-2023.pdf")
    whole = pdf_text(root / "que-found.pdf", layout=False)
    # The paper's PDF ends with the Reading Text Insert; questions 1 and 4
    # point at its numbered lines, so it is cut out with its margin numbers.
    paper = whole[whole.find("SECTION A") : whole.find("Section A: Reading Text Insert")]
    laid_out = pdf_text(root / "que-found.pdf")
    insert = laid_out[laid_out.find("Section A: Reading Text Insert") : laid_out.find("Acknowledgement:")]
    tariffs = {int(n): int(m) for n, m in re.findall(r"\(Total for Question (\d) = (\d+) marks?\)", paper)}
    prompts: dict[int, str] = {}
    cursor = 0
    for number in range(1, 7):
        # The writing tasks run on in one line: "EITHER *5 Write ... OR *6 Look ...".
        # Same line only: a page number "5" above "Turn over" is not question 5.
        found = re.compile(rf"(?m)(?:^|EITHER\s+|OR\s+)[ \t]*\*?{number}[ \t]+(?=[A-Z‘'“\"])").search(paper, cursor)
        if not found:
            continue
        end = paper.find(f"(Total for Question {number} =", found.end())
        body = paper[found.end() : end if end > 0 else len(paper)]
        body = re.sub(r"\.{4,}|\*P\d+A\d+\*|^\s*\d+\s*$|Turn over|DO NOT WRITE IN THIS AREA", " ", body, flags=re.M)
        prompts[number] = squash(body) + (
            f"\n\nReading Text Insert, with its line numbers:\n{insert.strip()}" if number in (1, 4) else ""
        )
        cursor = found.end()

    scheme_text = pdf_text(root / "ms.pdf")
    heads = list(re.finditer(r"(?m)^Question\s+(?=AO\d|Indicative|Number)", scheme_text))
    schemes: dict[int, str] = {}
    for position, head in enumerate(heads):
        block = scheme_text[head.start() : heads[position + 1].start() if position + 1 < len(heads) else len(scheme_text)]
        number = re.search(r"(?m)^\s*\*?([1-6])\s", block[:600])
        if number:
            schemes[int(number.group(1))] = block
    grids = scheme_text[scheme_text.find("Writing assessment grids") :]
    grids = re.sub(r"(?m)^AO5:\s*$", "AO5: Content and organisation (24 marks)", grids)
    grids = re.sub(r"(?m)^AO6:\s*$", "AO6: Vocabulary, sentence structure, spelling and punctuation (16 marks)", grids)
    for number in (5, 6):
        schemes[number] = schemes.get(number, "").split("Writing assessment grids")[0] + "\n" + grids

    records: list[Record] = []
    for response in pearson_stream(
        doc,
        section=re.compile(r"Question\s+(\d)\b"),
        label=re.compile(r"Script\s+(\d+)\b"),
        commentary="Examiner comment and mark",
    ):
        number = int(response["section"] or 0)
        text = response["commentary"]
        objectives = re.findall(r"(AO[56]):\s*Level\s+\d\s*\S\s*(\d{1,2})\s+marks?", text)
        single = AWARD_TEXT.search(text)
        awarded = sum(int(m) for _, m in objectives) if len(objectives) == 2 else (int(single.group(2)) if single else None)
        tariff = tariffs.get(number, 0)
        regime = "additive" if number in (1, 2) else ("weightedTraits" if number in (5, 6) else "banded")
        record_id = f"pearson:english:2023jun-p1:q{number}:s{response['letter']}"
        issues = []
        if awarded is None:
            issues.append(f"page {response['page'] + 1}: no award")
        if number not in prompts or number not in schemes:
            issues.append(f"no prompt or scheme for {number}")
        if awarded is not None and awarded > tariff:
            issues.append(f"award {awarded} over tariff {tariff}")
        if not response["scans"]:
            issues.append("no scan")
        stem = record_id.replace(":", "_")
        record = Record(
            id=record_id,
            board="Pearson Edexcel",
            course="GCSE English Language",
            subject="english",
            regime=regime,
            question_id=f"2023jun-p1:q{number}",
            prompt=prompts.get(number, ""),
            scheme=pearson_levels_notation(schemes.get(number, "")) if regime != "additive" else squash(schemes.get(number, "")),
            max_marks=tariff,
            awarded=awarded or 0,
            images=[save_image(doc, xref, f"{stem}_{n}") for n, xref in enumerate(response["scans"])] if not issues else [],
            commentary=squash(text),
            # Question 6 offers pictures the paper prints and the text layer cannot carry.
            stimulus_missing=number == 6,
            issues=issues,
        )
        record.objective_marks = [{"objective": ao, "marks": int(m)} for ao, m in objectives] if len(objectives) == 2 else None
        records.append(record)
    return records

SOURCES = [
    lambda: pearson_maths(DATASETS / "pearson/pearson-gcse-maths/GCSE_(9-1)_Mathematics_Summer_2017_Exemplar_answers_with_examiner_comments_Higher.pdf", "2017jun-h", "Higher"),
    lambda: pearson_maths(DATASETS / "pearson/pearson-gcse-maths/GCSE_(9-1)_Mathematics_November_2017_Exemplar_answers_with_examiner_comments_Higher.pdf", "2017nov-h", "Higher"),
    lambda: pearson_maths(DATASETS / "pearson/pearson-gcse-maths/higher-exemplar-gcse-june-2019-higher.pdf", "2019jun-h", "Higher"),
    lambda: pearson_web_export(DATASETS / "pearson/pearson-gcse-maths/final-22061ma1-1f.pdf", "2022jun-1f", "Foundation", "1F"),
    lambda: aqa_levels_typed(DATASETS / "aqa/history-2aa-ex.pdf", "2022jun-2aa", "GCSE History", "history"),
    lambda: aqa_levels_typed(DATASETS / "aqa/history-2ba-ex.pdf", "2022jun-2ba", "GCSE History", "history"),
    lambda: aqa_commentary(DATASETS / "aqa/geography-p1-ex.pdf", DATASETS / "aqa/geography-p1-ms-nov20.pdf", "2020nov-p1", "GCSE Geography", "geography"),
    lambda: aqa_commentary(DATASETS / "aqa/geography-p3-ex.pdf", DATASETS / "aqa/geography-p3-ms-nov20.pdf", "2020nov-p3", "GCSE Geography", "geography"),
    *[
        (lambda paper=paper, tier=tier: ocr_maths_exemplars(
            DATASETS / f"ocr/maths2017/ecw-{paper}.pdf", DATASETS / f"ocr/maths2017/qp-{paper}.pdf", DATASETS / f"ocr/maths2017/ms-{paper}.pdf", f"2017jun-{paper}", tier))
        for paper, tier in (("p1f", "Foundation"), ("p2f", "Foundation"), ("p5h", "Higher"), ("p6h", "Higher"))
    ],
    lambda: pearson_history_2022(
        DATASETS / "pearson/history-p1-2022.pdf", "2022jun-p1",
        {"2a": (("2a",), 8), "2b": (("2b",), 4), "5": (("5", "6"), 16)},
        {"Crime": PEARSON_HISTORY_MS / "p1-10-2022.pdf", "Medicine": PEARSON_HISTORY_MS / "p1-11-2022.pdf",
         "Warfare": PEARSON_HISTORY_MS / "p1-12-2022.pdf", "Migration": PEARSON_HISTORY_MS / "p1-13-2022.pdf"},
    ),
    lambda: pearson_history_2022(
        DATASETS / "pearson/history-p2-2022.pdf", "2022jun-p2",
        {"1b": (("1b",), 12), "1c": (("1ci", "1cii"), 16)},
        {"Anglo-Saxons and Normans": PEARSON_HISTORY_MS / "p2-b1-2022.pdf", "Richard and John": PEARSON_HISTORY_MS / "p2-b2-2022.pdf",
         "Henry VIII": None, "Elizabethan England": PEARSON_HISTORY_MS / "p2-b4-2022.pdf"},
    ),
    pearson_english_2023,
    lambda: aqa_specimen_responses(DATASETS / "aqa/geography-p2-ex.pdf", "specimen-p2", "GCSE Geography", "geography"),
]


def main() -> None:
    records: list[Record] = []
    for build in SOURCES:
        records.extend(build())
    # A levels-marked record whose table could not be read would reach the
    # marker with bands the adapter derives itself and a notice that the
    # source published no descriptors -- false for every board scheme here.
    # Measuring that marker is measuring a handicap, so it is left out.
    band = re.compile(r"(?m)^\s*(?:Level|Band)\s+\d+\s*[:.]?.*?\((\d+)\s*[-–—]\s*(\d+)\s*marks?\)\s*$")
    for record in records:
        if record.regime == "banded" and len(band.findall(record.scheme)) < 2 and not record.issues:
            record.issues.append("level table could not be read")
    kept = [r for r in records if not r.issues]
    issues = [f"{r.id}: {'; '.join(r.issues)}" for r in records if r.issues]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{SOURCE_ID}.json").write_text(
        json.dumps(
            {
                "records": [r.to_json() for r in kept],
                "stats": {"records": len(kept), "skipped": len(issues)},
                "issues": issues,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    summary: dict[str, int] = {}
    for r in kept:
        summary[f"{r.board} / {r.subject}"] = summary.get(f"{r.board} / {r.subject}", 0) + 1
    for key, count in sorted(summary.items()):
        print(f"{count:4d}  {key}")
    print(f"{len(kept)} kept, {len(issues)} skipped")
    for line in issues[:40]:
        print("  skip", line)


if __name__ == "__main__":
    sys.exit(main())
