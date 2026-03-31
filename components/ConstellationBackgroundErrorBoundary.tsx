"use client";

import React from "react";
import {
  setConstellationBackgroundCrashMarked,
  setConstellationBackgroundEnabled,
} from "@/lib/constellation-background";

type ConstellationBackgroundErrorBoundaryProps = {
  children: React.ReactNode;
};

type ConstellationBackgroundErrorBoundaryState = {
  hasError: boolean;
};

export default class ConstellationBackgroundErrorBoundary extends React.Component<
  ConstellationBackgroundErrorBoundaryProps,
  ConstellationBackgroundErrorBoundaryState
> {
  state: ConstellationBackgroundErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ConstellationBackgroundErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Constellation background crashed; disabling background render.", error);
    setConstellationBackgroundCrashMarked(true);
    setConstellationBackgroundEnabled(false);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}
