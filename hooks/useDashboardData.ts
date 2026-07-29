"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  runDashboardDataRequest,
  type DashboardDataRequestOutcome,
} from "@/lib/app/dashboard-data";

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

  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    onLoadStartRef.current?.();

    return runDashboardDataRequest({
      load: () => loadRef.current(),
      isCurrent: () => requestId === requestIdRef.current,
      apply: (data) => applyRef.current(data),
      onError: (error) => onErrorRef.current(error),
      onSettled: () => setLoading(false),
    });
  }, []);

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
