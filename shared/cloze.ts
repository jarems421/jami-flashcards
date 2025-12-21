export function parseCloze(text: string) {
  const clozeRegex = /{{c(\d+)::(.*?)(?:::(.*?))?}}/g;
  const matches = [...text.matchAll(clozeRegex)];
  
  // Find unique cloze indices
  const indices = new Set<number>();
  matches.forEach(m => indices.add(parseInt(m[1])));
  
  return {
    indices: Array.from(indices).sort((a, b) => a - b),
    render: (index: number) => {
      // Replace the active cloze (index) with [...] or [hint]
      // Replace inactive clozes with their content (answer)
      const question = text.replace(clozeRegex, (match, n, content, hint) => {
        if (parseInt(n) === index) {
          return `<span class="cloze-bracket">[</span><span class="cloze-content">${hint || '...'}</span><span class="cloze-bracket">]</span>`;
        }
        return content;
      });

      const answer = text.replace(clozeRegex, (match, n, content, hint) => {
        if (parseInt(n) === index) {
          return `<span class="cloze-active">${content}</span>`;
        }
        return content;
      });

      return { question, answer };
    }
  };
}
