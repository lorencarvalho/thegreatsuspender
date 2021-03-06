/*global chrome, localStorage, tgs, gsUtils, gsChrome, GsTabQueue, gsTabSuspendManager */
// eslint-disable-next-line no-unused-vars
var gsTabDiscardManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_DISCARDS = 5;
  const DEFAULT_DISCARD_TIMEOUT = 5 * 1000;

  let discardQueue;

  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_DISCARDS,
        jobTimeout: DEFAULT_DISCARD_TIMEOUT,
        executorFn: performDiscard,
        exceptionFn: handleDiscardException,
      };
      discardQueue = GsTabQueue('discardQueue', queueProps);
      resolve();
    });
  }

  function queueTabForDiscard(tab) {
    queueTabForDiscardAsPromise(tab).catch(e => {
      gsUtils.log(tab.id, e);
    });;
  }

  function queueTabForDiscardAsPromise(tab) {
    gsUtils.log(tab.id, `Queuing tab for discarding.`);
    return discardQueue.queueTabAsPromise(tab);
  }

  function unqueueTabForDiscard(tab) {
    const removed = discardQueue.unqueueTab(tab);
    if (removed) {
      gsUtils.log(tab.id, `Removed tab from discard queue.`);
    }
  }

  // This is called remotely by the discardQueue
  // So we must first re-fetch the tab in case it has changed
  async function performDiscard(tab, executionProps, resolve, reject, requeue) {
    let _tab = null;
    try {
      _tab = await gsChrome.tabsGet(tab.id);
    } catch (error) {
      // assume tab has been discarded
    }
    if (!_tab) {
      gsUtils.warning(
        tab.id,
        `Failed to discard tab. Tab may have already been discarded or removed.`
      );
      resolve(false);
      return;
    }
    tab = _tab;

    if (gsUtils.isSuspendedTab(tab) && tab.status === 'loading') {
      gsUtils.log(tab.id, 'Tab is still loading');
      requeue();
      return;
    }
    if (tgs.isCurrentActiveTab(tab)) {
      gsUtils.log(tab.id, 'Tab is active. Aborting discard.');
      resolve(false);
      return;
    }
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, 'Tab already discarded');
      resolve(false);
      return;
    }
    gsUtils.log(tab.id, 'Forcing discarding of tab.');
    chrome.tabs.discard(tab.id, () => {
      if (chrome.runtime.lastError) {
        gsUtils.warning(tab.id, chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }

  function handleDiscardException(
    tab,
    executionProps,
    exceptionType,
    resolve,
    reject,
    requeue
  ) {
    gsUtils.warning(tab.id, `Failed to discard tab: ${exceptionType}`);
    resolve(false);
  }

  async function handleDiscardedUnsuspendedTab(tab) {
    if (
      gsUtils.shouldSuspendDiscardedTabs() &&
      gsTabSuspendManager.checkTabEligibilityForSuspension(tab, 3)
    ) {
      tgs.setSuspendedTabPropForTabId(tab.id, tgs.STP_SUSPEND_REASON, 3);
      const suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
      gsUtils.log(tab.id, 'Suspending discarded unsuspended tab');

      // Note: This bypasses the suspension tab queue and also prevents screenshots from being taken
      await gsTabSuspendManager.forceTabSuspension(tab, suspendedUrl);
      return;
    }
  }

  return {
    initAsPromised,
    queueTabForDiscard,
    queueTabForDiscardAsPromise,
    unqueueTabForDiscard,
    handleDiscardedUnsuspendedTab,
  };
})();
