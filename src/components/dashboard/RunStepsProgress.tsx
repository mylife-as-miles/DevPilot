import React from "react";
import { RunStep } from "../../types";

interface RunStepsProgressProps {
    steps: RunStep[];
}

export const RunStepsProgress: React.FC<RunStepsProgressProps> = ({ steps }) => {
    if (!steps || steps.length === 0) return null;

    return (
        <div className="mb-6 px-2">
            <div className="flex items-center gap-2 mb-4 text-slate-200 font-semibold tracking-wide">
                <span className="material-symbols-outlined text-[18px] text-slate-400">format_list_bulleted</span>
                <span className="text-sm">Plan</span>
            </div>
            <div className="space-y-4">
                {steps.map((step, index) => {
                    if (step.status === "completed") {
                        return (
                            <div key={step.id || index} className="flex items-start gap-3">
                                <span className="material-symbols-outlined text-[18px] text-emerald-500 mt-0.5">check_circle</span>
                                <span className="text-slate-200 text-[13px] leading-tight mt-0.5">{step.label}</span>
                            </div>
                        );
                    } else if (step.status === "running") {
                        return (
                            <div key={step.id || index} className="flex flex-col gap-2.5">
                                <div className="flex items-start gap-3">
                                    <span className="material-symbols-outlined text-[18px] text-blue-400 mt-0.5 animate-spin hidden">data_usage</span>
                                    <svg className="w-[18px] h-[18px] text-blue-400 animate-spin mt-0.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="45 15" strokeLinecap="round" />
                                    </svg>
                                    <span className="text-slate-100 font-medium text-[13px] leading-tight mt-0.5">{step.label}</span>
                                </div>
                                {step.detail && (
                                    <div className="flex items-center gap-2 ml-1.5 pl-4 -mt-1">
                                        <span className="text-slate-600 font-mono text-[14px]">└──</span>
                                        <span className="flex items-center gap-1.5 text-slate-400 text-[12px]">
                                            <span className="material-symbols-outlined text-[14px]">edit</span>
                                            {step.detail}
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    } else {
                        // Pending or Failed
                        return (
                            <div key={step.id || index} className="flex items-start gap-3">
                                <span className="material-symbols-outlined text-[18px] text-slate-600 mt-0.5">radio_button_unchecked</span>
                                <span className="text-slate-500 text-[13px] leading-tight mt-0.5">{step.label}</span>
                            </div>
                        );
                    }
                })}
            </div>
        </div>
    );
};
