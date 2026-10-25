// One owner holds the conversation channel, including during buffering or pause.
export function createDialogueSession() {
  let owner = null;
  return {
    get busy() { return owner !== null; },
    isBlocked(requester) { return owner !== null && owner !== requester; },
    begin(requester) {
      if (owner !== null && owner !== requester) return false;
      owner = requester;
      return true;
    },
    end(requester) { if (owner === requester) owner = null; },
  };
}
export const dialogueSession = createDialogueSession();
