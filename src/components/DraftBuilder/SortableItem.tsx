// components/DraftBuilder/SortableItem.tsx
"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";



type Props = {
  id: string;
  children?: React.ReactNode;
};

export const SortableItem = ({ id, children }: Props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex items-start gap-2 border rounded-lg p-4 mb-2 bg-white shadow-sm"
    >
      <button {...listeners} className="cursor-grab">
        <GripVertical className="text-gray-400" />
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
};
