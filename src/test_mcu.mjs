import { executeMcuCode } from './utils/mcu.ts';

const code = `
pinMode('D0', 'OUTPUT');
while(true) {
  digitalWrite('D0', 1);
  sleep(500);
  digitalWrite('D0', 0);
  sleep(500);
}
`;
const res = executeMcuCode(code, 1.0, {});
console.log(JSON.stringify(res, null, 2));
