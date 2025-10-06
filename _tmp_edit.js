const fs = require('fs');
const path = 'src/app/interview/page.tsx';
let t = fs.readFileSync(path, 'utf8');
const old = "if (done) {\n          enableFreeFlow(blkForSession);\n          finalQ = (agentQ && /\\\\?\\\\s*$/.test(agentQ)) ? agentQ : await getFreeChatQuestion(blkForSession, corrected);\n        } else {\n          finalQ = agentQ || nextQuestion;\n        }";
const neu = "if (done) {\n          enableFreeFlow(blkForSession);\n          finalQ = (agentQ && /\\\\?\\\\s*$/.test(agentQ)) ? agentQ : await getFreeChatQuestion(blkForSession, corrected);\n        } else {\n          // Si l'agent ne propose pas une question claire, tente une relance contextuelle\n          if (!agentQ || !/\\\\?\\\\s*$/.test(agentQ)) {\n            const probeQ = await getFreeChatQuestion(blkForSession, corrected);\n            finalQ = probeQ || nextQuestion;\n          } else {\n            finalQ = agentQ;\n          }\n        }";
if (!t.includes(old)) { throw new Error('pattern not found'); }
t = t.replace(old, neu);
fs.writeFileSync(path, t, 'utf8');
console.log('patched');
