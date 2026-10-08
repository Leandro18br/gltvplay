import { queryOptions } from "@tanstack/react-query";
import { getPublishedHome, getHomeDraft } from "./home.functions";
export const publishedHomeQuery = queryOptions({queryKey:["catalog","home-layout"],queryFn:()=>getPublishedHome(),staleTime:0,refetchInterval:15000,refetchOnWindowFocus:true});
export const homeDraftQuery = queryOptions({queryKey:["admin","home-draft"],queryFn:()=>getHomeDraft(),staleTime:0});