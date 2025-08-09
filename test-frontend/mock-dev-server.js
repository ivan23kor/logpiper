
const readline = require('readline');

console.log('🚀 Starting development server...');
console.log('📁 Project: test-frontend');
console.log('🌐 Local: http://localhost:3000');

let logCount = 0;

const generateLogs = () => {
  logCount++;
  
  if (logCount % 10 === 0) {
    console.log('✅ Hot reload complete - 2.1s');
  } else if (logCount % 15 === 0) {
    console.error('❌ TypeScript Error: Property \'user\' does not exist on type \'Props\'');
    console.error('    at src/components/UserProfile.tsx:15:7');
  } else if (logCount % 7 === 0) {
    console.log('📦 Compiled successfully in 890ms');
  } else {
    console.log(`[Dev] Processing request ${Math.floor(Math.random() * 1000)}`);
  }
};

setInterval(generateLogs, 2000);

console.log('\n🔄 Press Ctrl+C to stop...');
    