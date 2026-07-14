import React from "react";
import { Task } from "../../types";

interface TabsProps {
    activeTab: Task["category"];
    onTabChange: (tab: Task["category"]) => void;
}

export const Tabs: React.FC<TabsProps> = ({ activeTab, onTabChange }) => {
    const tabs: { id: Task["category"]; label: string }[] = [
        { id: "tasks", label: "Tasks" },
        { id: "code_reviews", label: "Code reviews" },
        { id: "archive", label: "Archive" },
    ];

    return (
        <div className="mb-6 flex items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-border-subtle sm:mb-8 sm:gap-8 hide-scrollbar">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={`pb-4 text-sm transition-colors ${activeTab === tab.id
                            ? "border-b-2 border-primary font-semibold text-primary"
                            : "font-medium text-slate-500 hover:text-slate-300"
                        }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
};
