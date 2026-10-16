@AGENTS.md

As regras deste projeto estão em [AGENTS.md](AGENTS.md) e valem para qualquer agente. Resumo do que nunca pode faltar:

- Toda tarefa começa com uma **issue** no GitHub; todo código entra por **PR** com `Closes #<issue>` na descrição.
- Merge na `main` faz deploy no Cloudflare — só com CI verde.
- Cloudflare, Notion e Melhor Envio são **contas do Cubodex, separadas do Hortelã**; só o Mercado Pago é o mesmo.
- Motion: use a skill `.claude/skills/design-motion-principles` (e-commerce → Jakub primário, Emil secundário),
  com skeleton, lazy loading, entrada/saída/carregamento/progresso e `prefers-reduced-motion`.
- Código: siga a skill `.claude/skills/ponytail` (nível full) e rode a `ponytail-review` antes de pedir merge.
