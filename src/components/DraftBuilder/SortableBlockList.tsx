"use client";

import React from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableItem } from "./SortableItem";

interface SortableBlockListProps {
  items: any[]; // tableau d’objets blocs [{ id, title, summary }]
  onReorder: (newOrder: string[]) => void;
  renderItem: (item: any) => React.ReactNode; // fonction pour afficher le bloc
}

export const SortableBlockList: React.FC<SortableBlockListProps> = ({
  items,
  onReorder,
  renderItem,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return; // sécurité

    if (active.id !== over.id) {
      const oldIndex = items.findIndex((b) => b.id === active.id);
      const newIndex = items.findIndex((b) => b.id === over.id);
      const newOrder = arrayMove(items, oldIndex, newIndex).map((b) => b.id);
      onReorder(newOrder);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {items.map((block) => (
          <SortableItem key={block.id} id={block.id}>
            <div className="transition-shadow hover:shadow-md">
              {renderItem(block)}
            </div>
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
};
