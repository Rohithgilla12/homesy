import { usePendingLink } from '../pendingLink';

describe('pending deep link', () => {
  beforeEach(() => usePendingLink.getState().clear());
  it('keeps an app path and hands it to the post-sign-in redirect', () => {
    usePendingLink.getState().remember('/join/AZ8M7X');
    expect(usePendingLink.getState().target()).toBe('/join/AZ8M7X');
  });
  it('ignores auth screens so a plain sign-in still lands on Lists', () => {
    usePendingLink.getState().remember('/login');
    expect(usePendingLink.getState().target()).toBe('/');
  });
  it('a later sign-in screen visit does not wipe a remembered link', () => {
    usePendingLink.getState().remember('/join/AZ8M7X');
    usePendingLink.getState().remember('/login');
    expect(usePendingLink.getState().target()).toBe('/join/AZ8M7X');
  });
  it('clears once used', () => {
    usePendingLink.getState().remember('/join/AZ8M7X');
    usePendingLink.getState().clear();
    expect(usePendingLink.getState().target()).toBe('/');
  });
});
