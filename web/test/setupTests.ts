import '@testing-library/jest-dom';

// Mock ResizeObserver for recharts compatibility in jsdom
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock clipboard API
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

// Mock URL.createObjectURL
URL.createObjectURL = vi.fn(() => 'blob:test');
URL.revokeObjectURL = vi.fn();

// Mock wavesurfer.js for tests (may not be installed)
vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => ({
      load: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      playPause: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
      getDuration: vi.fn(() => 120),
      setPlaybackRate: vi.fn(),
      seekTo: vi.fn(),
    })),
  },
}));