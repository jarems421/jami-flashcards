"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  runDashboardDataRequest,
  type DashboardDataRequestOutcome,
} from "@/lib/app/dashboard-data";
import { subscribeToCachedReads } from "@/services/cache/read-through";

type UseDashboardDataOptions<T> = {
  requestKey: string;
  load: () => Promise<T>;
  apply: (data: T) => void;
  onError: (error: unknown) => void;
  onLoadStart?: () => void;
};

type UseDashboardDataResult = {
  loading: boolean;
  reload: () => Promise<DashboardDataRequestOutcome>;
};

export function useDashboardData<T>({
  requestKey,
  load,
  apply,
  onError,
  onLoadStart,
}: UseDashboardDataOptions<T>): UseDashboardDataResult {
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const loadRef = useRef(load);
  const applyRef = useRef(apply);
  const onErrorRef = useRef(onError);
  const onLoadStartRef = useRef(onLoadStart);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onLoadStartRef.current = onLoadStart;
  }, [onLoadStart]);

  const run = useCallback(async (options: { quiet?: boolean } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!options.quiet) {
      setLoading(true);
      onLoadStartRef.current?.();
    }

    return runDashboardDataRequest({
      load: () => loadRef.current(),
      isCurrent: () => requestId === requestIdRef.current,
      apply: (data) => applyRef.current(data),
      onError: (error) => onErrorRef.current(error),
      onSettled: () => setLoading(false),
    });
  }, []);

  const reload = useCallback(() => run(), [run]);

  /**
   * A page is answered from the cache the moment its data has merely aged, and
   * the refresh runs behind it. This picks the refreshed value up.
   *
   * Quietly: the page is already showing something, so raising its loading flag
   * would replace what the student is reading with a spinner to tell them it
   * has been confirmed. The reads are fresh in the cache by now, so this is a
   * re-render rather than a round trip.
   */
  useEffect(() => {
    if (!requestKey) return;
    return subscribeToCachedReads(requestKey, () => {
      void run({ quiet: true });
    });
  }, [requestKey, run]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void reload();
      }
    });

    return () => {
      cancelled = true;
      requestIdRef.current += 1;
    };
  }, [reload, requestKey]);

  return { loading, reload };
}
