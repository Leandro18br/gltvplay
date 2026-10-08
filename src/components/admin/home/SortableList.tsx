import type { ReactNode } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moveItem } from "@/lib/home/model";

function SortableEntry({id,children,index,count,onMove}:{id:string;children:ReactNode;index:number;count:number;onMove:(from:number,to:number)=>void}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging} = useSortable({id});
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className={`relative flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-3 ${isDragging ? "z-20 opacity-70" : ""}`}>
    <Button variant="ghost" size="icon" className="size-8 shrink-0 touch-none text-muted-foreground" aria-label={`Arrastar item ${index+1}`} {...attributes} {...listeners}><GripVertical className="size-4" /></Button>
    <div className="min-w-0 flex-1">{children}</div>
    <div className="flex shrink-0 flex-col"><Button variant="ghost" size="icon" className="size-6" disabled={index===0} aria-label="Mover para cima" onClick={()=>onMove(index,index-1)}><ArrowUp className="size-3" /></Button><Button variant="ghost" size="icon" className="size-6" disabled={index===count-1} aria-label="Mover para baixo" onClick={()=>onMove(index,index+1)}><ArrowDown className="size-3" /></Button></div>
  </div>;
}
export function SortableList<T>({items,getId,onChange,render}:{items:T[];getId:(item:T)=>string;onChange:(items:T[])=>void;render:(item:T,index:number)=>ReactNode}) {
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:5}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  function dragEnd(e:DragEndEvent) {if(e.over) onChange(moveItem(items,items.findIndex(i=>getId(i)===e.active.id),items.findIndex(i=>getId(i)===e.over?.id)));}
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}><div className="space-y-2">{items.map((item,index)=><SortableEntry key={getId(item)} id={getId(item)} index={index} count={items.length} onMove={(from,to)=>onChange(moveItem(items,from,to))}>{render(item,index)}</SortableEntry>)}</div></SortableContext></DndContext>;
}