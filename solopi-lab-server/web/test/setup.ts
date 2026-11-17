import { cleanup } from '@testing-library/react';
import { beforeEach,afterEach,vi } from 'vitest';

afterEach(() => {
  cleanup();
});

beforeEach(()=>{if(typeof matchMedia!=='function')vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));});
