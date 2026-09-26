import { createMockApp } from './app.js';

const port = Number(process.env.MOCK_PORT ?? 4000);
createMockApp().listen(port, () => console.log(JSON.stringify({ msg: 'mock community api listening', port })));
