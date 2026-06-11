const fs = require('fs')
const path = require('path')

const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md')

if (!fs.existsSync(claudeMdPath)) process.exit(0)

const content = fs.readFileSync(claudeMdPath, 'utf8')

const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      'CLAUDE.md detected. Before answering the first message, output a structured project overview using this exact format — no prose paragraphs:\n\n' +
      '**Project:** [name and one-line purpose]\n' +
      '**Stack:** [framework · language · runtime]\n' +
      '**Pattern:** [state management · rendering · auth approach]\n' +
      '**Core domain:** [the primary business logic / feature area]\n' +
      '**Key entry points:** [2-3 files that matter most]\n\n' +
      'Then stop. Do not add any paragraph explanation after the list.\n\n---\n' +
      content
  }
}

process.stdout.write(JSON.stringify(output))
