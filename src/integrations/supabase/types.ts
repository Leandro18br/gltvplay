export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      api_credentials: {
        Row: {
          api_key: string | null
          integration_id: string
          token: string | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          integration_id: string
          token?: string | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          integration_id?: string
          token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_credentials_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "api_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_endpoints: {
        Row: {
          body: string | null
          created_at: string
          description: string | null
          headers: Json
          id: string
          integration_id: string
          is_active: boolean
          kind: string
          mapping: Json
          method: string
          name: string
          path: string
          query: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          description?: string | null
          headers?: Json
          id?: string
          integration_id: string
          is_active?: boolean
          kind: string
          mapping?: Json
          method?: string
          name: string
          path?: string
          query?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          description?: string | null
          headers?: Json
          id?: string
          integration_id?: string
          is_active?: boolean
          kind?: string
          mapping?: Json
          method?: string
          name?: string
          path?: string
          query?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_endpoints_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "api_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_integrations: {
        Row: {
          auth_method: string
          auth_param: string | null
          auto_fetch_player: boolean
          base_url: string
          cache_ttl_seconds: number
          created_at: string
          default_method: string
          description: string | null
          headers: Json
          id: string
          is_active: boolean
          key_hint: string | null
          kind: string
          last_error: string | null
          last_status: string
          last_tested_at: string | null
          name: string
          params: Json
          priority: number
          rate_limit_per_minute: number
          request_count: number
          token_hint: string | null
          updated_at: string
        }
        Insert: {
          auth_method?: string
          auth_param?: string | null
          auto_fetch_player?: boolean
          base_url: string
          cache_ttl_seconds?: number
          created_at?: string
          default_method?: string
          description?: string | null
          headers?: Json
          id?: string
          is_active?: boolean
          key_hint?: string | null
          kind: string
          last_error?: string | null
          last_status?: string
          last_tested_at?: string | null
          name: string
          params?: Json
          priority?: number
          rate_limit_per_minute?: number
          request_count?: number
          token_hint?: string | null
          updated_at?: string
        }
        Update: {
          auth_method?: string
          auth_param?: string | null
          auto_fetch_player?: boolean
          base_url?: string
          cache_ttl_seconds?: number
          created_at?: string
          default_method?: string
          description?: string | null
          headers?: Json
          id?: string
          is_active?: boolean
          key_hint?: string | null
          kind?: string
          last_error?: string | null
          last_status?: string
          last_tested_at?: string | null
          name?: string
          params?: Json
          priority?: number
          rate_limit_per_minute?: number
          request_count?: number
          token_hint?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      api_request_logs: {
        Row: {
          actor_id: string | null
          cached: boolean
          content_label: string | null
          created_at: string
          duration_ms: number | null
          endpoint_id: string | null
          error: string | null
          http_status: number | null
          id: string
          integration_id: string | null
          success: boolean
        }
        Insert: {
          actor_id?: string | null
          cached?: boolean
          content_label?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint_id?: string | null
          error?: string | null
          http_status?: number | null
          id?: string
          integration_id?: string | null
          success?: boolean
        }
        Update: {
          actor_id?: string | null
          cached?: boolean
          content_label?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint_id?: string | null
          error?: string | null
          http_status?: number | null
          id?: string
          integration_id?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "api_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "api_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_response_cache: {
        Row: {
          body: string
          cache_key: string
          created_at: string
          expires_at: string
          http_status: number
          integration_id: string
        }
        Insert: {
          body: string
          cache_key: string
          created_at?: string
          expires_at: string
          http_status: number
          integration_id: string
        }
        Update: {
          body?: string
          cache_key?: string
          created_at?: string
          expires_at?: string
          http_status?: number
          integration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_response_cache_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "api_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          changes: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          changes?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          changes?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          summary?: string | null
        }
        Relationships: []
      }
      banners: {
        Row: {
          button_label: string | null
          button_url: string | null
          content_id: string | null
          content_kind: Database["public"]["Enums"]["content_kind"] | null
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          button_label?: string | null
          button_url?: string | null
          content_id?: string | null
          content_kind?: Database["public"]["Enums"]["content_kind"] | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          button_label?: string | null
          button_url?: string | null
          content_id?: string | null
          content_kind?: Database["public"]["Enums"]["content_kind"] | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          slug: string
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          slug: string
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          slug?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          featured: boolean
          id: string
          logo_url: string | null
          name: string
          slug: string | null
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          logo_url?: string | null
          name: string
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      embed_domains: {
        Row: {
          created_at: string
          hostname: string
          id: string
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
        }
        Relationships: []
      }
      episodes: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number | null
          episode_number: number
          id: string
          original_title: string | null
          release_date: string | null
          season_id: string
          status: Database["public"]["Enums"]["content_status"]
          still_path: string | null
          thumbnail_url: string | null
          title: string
          tmdb_id: number | null
          updated_at: string
          vote_average: number | null
          vote_count: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          episode_number: number
          id?: string
          original_title?: string | null
          release_date?: string | null
          season_id: string
          status?: Database["public"]["Enums"]["content_status"]
          still_path?: string | null
          thumbnail_url?: string | null
          title: string
          tmdb_id?: number | null
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          episode_number?: number
          id?: string
          original_title?: string | null
          release_date?: string | null
          season_id?: string
          status?: Database["public"]["Enums"]["content_status"]
          still_path?: string | null
          thumbnail_url?: string | null
          title?: string
          tmdb_id?: number | null
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "episodes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      genres: {
        Row: {
          created_at: string
          id: string
          is_fixed: boolean
          name: string
          slug: string
          tmdb_genre_ids: number[]
        }
        Insert: {
          created_at?: string
          id?: string
          is_fixed?: boolean
          name: string
          slug: string
          tmdb_genre_ids?: number[]
        }
        Update: {
          created_at?: string
          id?: string
          is_fixed?: boolean
          name?: string
          slug?: string
          tmdb_genre_ids?: number[]
        }
        Relationships: []
      }
      home_layouts: {
        Row: {
          config: Json
          id: string
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          id?: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          id?: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      movie_genres: {
        Row: {
          genre_id: string
          movie_id: string
        }
        Insert: {
          genre_id: string
          movie_id: string
        }
        Update: {
          genre_id?: string
          movie_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "movie_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movie_genres_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
        ]
      }
      movies: {
        Row: {
          age_rating: string | null
          backdrop_path: string | null
          backdrop_url: string | null
          category_id: string | null
          country: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          external_id: string | null
          external_source: string | null
          featured: boolean
          id: string
          imdb_id: string | null
          language: string | null
          original_title: string | null
          popularity: number | null
          poster_path: string | null
          poster_url: string | null
          quality: string | null
          release_date: string | null
          release_year: number | null
          slug: string | null
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          tagline: string | null
          title: string
          tmdb_id: number | null
          tmdb_status: string | null
          tmdb_synced_at: string | null
          trailer_url: string | null
          updated_at: string
          vote_average: number | null
          vote_count: number | null
        }
        Insert: {
          age_rating?: string | null
          backdrop_path?: string | null
          backdrop_url?: string | null
          category_id?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          external_id?: string | null
          external_source?: string | null
          featured?: boolean
          id?: string
          imdb_id?: string | null
          language?: string | null
          original_title?: string | null
          popularity?: number | null
          poster_path?: string | null
          poster_url?: string | null
          quality?: string | null
          release_date?: string | null
          release_year?: number | null
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          tagline?: string | null
          title: string
          tmdb_id?: number | null
          tmdb_status?: string | null
          tmdb_synced_at?: string | null
          trailer_url?: string | null
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
        }
        Update: {
          age_rating?: string | null
          backdrop_path?: string | null
          backdrop_url?: string | null
          category_id?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          external_id?: string | null
          external_source?: string | null
          featured?: boolean
          id?: string
          imdb_id?: string | null
          language?: string | null
          original_title?: string | null
          popularity?: number | null
          poster_path?: string | null
          poster_url?: string | null
          quality?: string | null
          release_date?: string | null
          release_year?: number | null
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          tagline?: string | null
          title?: string
          tmdb_id?: number | null
          tmdb_status?: string | null
          tmdb_synced_at?: string | null
          trailer_url?: string | null
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movies_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      playback_diagnostics: {
        Row: {
          actor_id: string
          created_at: string
          event: string
          id: string
          source_id: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          event: string
          id?: string
          source_id?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          event?: string
          id?: string
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playback_diagnostics_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playback_diagnostics_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "playback_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      playback_sources: {
        Row: {
          api_integration_id: string | null
          content_id: string
          content_kind: Database["public"]["Enums"]["content_kind"]
          created_at: string
          drm: Json
          external_ref: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          label: string | null
          provider: string | null
          quality: string | null
          sort_order: number
          source_type: string
          updated_at: string
          url: string
        }
        Insert: {
          api_integration_id?: string | null
          content_id: string
          content_kind: Database["public"]["Enums"]["content_kind"]
          created_at?: string
          drm?: Json
          external_ref?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label?: string | null
          provider?: string | null
          quality?: string | null
          sort_order?: number
          source_type?: string
          updated_at?: string
          url: string
        }
        Update: {
          api_integration_id?: string | null
          content_id?: string
          content_kind?: Database["public"]["Enums"]["content_kind"]
          created_at?: string
          drm?: Json
          external_ref?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label?: string | null
          provider?: string | null
          quality?: string | null
          sort_order?: number
          source_type?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "playback_sources_api_integration_id_fkey"
            columns: ["api_integration_id"]
            isOneToOne: false
            referencedRelation: "api_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          last_seen_at: string | null
          name: string | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          last_seen_at?: string | null
          name?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          air_date: string | null
          created_at: string
          description: string | null
          id: string
          poster_url: string | null
          season_number: number
          series_id: string
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          title: string | null
          tmdb_id: number | null
          updated_at: string
        }
        Insert: {
          air_date?: string | null
          created_at?: string
          description?: string | null
          id?: string
          poster_url?: string | null
          season_number: number
          series_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string | null
          tmdb_id?: number | null
          updated_at?: string
        }
        Update: {
          air_date?: string | null
          created_at?: string
          description?: string | null
          id?: string
          poster_url?: string | null
          season_number?: number
          series_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string | null
          tmdb_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      series: {
        Row: {
          age_rating: string | null
          backdrop_path: string | null
          backdrop_url: string | null
          category_id: string | null
          country: string | null
          created_at: string
          description: string | null
          external_id: string | null
          external_source: string | null
          featured: boolean
          first_air_date: string | null
          id: string
          imdb_id: string | null
          language: string | null
          number_of_episodes: number | null
          number_of_seasons: number | null
          original_title: string | null
          popularity: number | null
          poster_path: string | null
          poster_url: string | null
          release_year: number | null
          slug: string | null
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          tagline: string | null
          title: string
          tmdb_id: number | null
          tmdb_status: string | null
          tmdb_synced_at: string | null
          trailer_url: string | null
          updated_at: string
          vote_average: number | null
          vote_count: number | null
        }
        Insert: {
          age_rating?: string | null
          backdrop_path?: string | null
          backdrop_url?: string | null
          category_id?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          featured?: boolean
          first_air_date?: string | null
          id?: string
          imdb_id?: string | null
          language?: string | null
          number_of_episodes?: number | null
          number_of_seasons?: number | null
          original_title?: string | null
          popularity?: number | null
          poster_path?: string | null
          poster_url?: string | null
          release_year?: number | null
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          tagline?: string | null
          title: string
          tmdb_id?: number | null
          tmdb_status?: string | null
          tmdb_synced_at?: string | null
          trailer_url?: string | null
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
        }
        Update: {
          age_rating?: string | null
          backdrop_path?: string | null
          backdrop_url?: string | null
          category_id?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          featured?: boolean
          first_air_date?: string | null
          id?: string
          imdb_id?: string | null
          language?: string | null
          number_of_episodes?: number | null
          number_of_seasons?: number | null
          original_title?: string | null
          popularity?: number | null
          poster_path?: string | null
          poster_url?: string | null
          release_year?: number | null
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          tagline?: string | null
          title?: string
          tmdb_id?: number | null
          tmdb_status?: string | null
          tmdb_synced_at?: string | null
          trailer_url?: string | null
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "series_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      series_genres: {
        Row: {
          genre_id: string
          series_id: string
        }
        Insert: {
          genre_id: string
          series_id: string
        }
        Update: {
          genre_id?: string
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_genres_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          banner: Json
          colors: Json
          embed_allow_iframe: boolean
          favicon_url: string | null
          general: Json
          id: number
          logo_url: string | null
          platform_name: string
          social_links: Json
          texts: Json
          updated_at: string
        }
        Insert: {
          banner?: Json
          colors?: Json
          embed_allow_iframe?: boolean
          favicon_url?: string | null
          general?: Json
          id?: number
          logo_url?: string | null
          platform_name?: string
          social_links?: Json
          texts?: Json
          updated_at?: string
        }
        Update: {
          banner?: Json
          colors?: Json
          embed_allow_iframe?: boolean
          favicon_url?: string | null
          general?: Json
          id?: number
          logo_url?: string | null
          platform_name?: string
          social_links?: Json
          texts?: Json
          updated_at?: string
        }
        Relationships: []
      }
      tmdb_cache: {
        Row: {
          body: Json
          cache_key: string
          created_at: string
          expires_at: string
        }
        Insert: {
          body: Json
          cache_key: string
          created_at?: string
          expires_at: string
        }
        Update: {
          body?: Json
          cache_key?: string
          created_at?: string
          expires_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      viewer_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          is_kids: boolean
          name: string
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          is_kids?: boolean
          name: string
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          is_kids?: boolean
          name?: string
          preferences?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "viewer_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_history: {
        Row: {
          content_id: string
          content_kind: Database["public"]["Enums"]["content_kind"]
          id: string
          position_seconds: number
          progress_percent: number
          user_id: string
          viewer_profile_id: string | null
          watched_at: string
        }
        Insert: {
          content_id: string
          content_kind: Database["public"]["Enums"]["content_kind"]
          id?: string
          position_seconds?: number
          progress_percent?: number
          user_id: string
          viewer_profile_id?: string | null
          watched_at?: string
        }
        Update: {
          content_id?: string
          content_kind?: Database["public"]["Enums"]["content_kind"]
          id?: string
          position_seconds?: number
          progress_percent?: number
          user_id?: string
          viewer_profile_id?: string | null
          watched_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "watch_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_history_viewer_profile_id_fkey"
            columns: ["viewer_profile_id"]
            isOneToOne: false
            referencedRelation: "viewer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          added_at: string
          content_id: string
          content_kind: Database["public"]["Enums"]["content_kind"]
          id: string
          user_id: string
          viewer_profile_id: string | null
        }
        Insert: {
          added_at?: string
          content_id: string
          content_kind: Database["public"]["Enums"]["content_kind"]
          id?: string
          user_id: string
          viewer_profile_id?: string | null
        }
        Update: {
          added_at?: string
          content_id?: string
          content_kind?: Database["public"]["Enums"]["content_kind"]
          id?: string
          user_id?: string
          viewer_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watchlist_viewer_profile_id_fkey"
            columns: ["viewer_profile_id"]
            isOneToOne: false
            referencedRelation: "viewer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_role: {
        Args: {
          _enabled: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_stats: { Args: never; Returns: Json }
      embed_url_allowed: { Args: { u: string }; Returns: boolean }
      ensure_fixed_genres: { Args: never; Returns: undefined }
      get_playback_source: {
        Args: {
          _content_id: string
          _kind: Database["public"]["Enums"]["content_kind"]
        }
        Returns: Json
      }
      get_playback_sources: {
        Args: {
          _content_id: string
          _kind: Database["public"]["Enums"]["content_kind"]
        }
        Returns: Json
      }
      get_playback_url: {
        Args: {
          _content_id: string
          _kind: Database["public"]["Enums"]["content_kind"]
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      my_role: { Args: never; Returns: string }
      norm_genre: { Args: { t: string }; Returns: string }
      popular_content: {
        Args: {
          _kind: Database["public"]["Enums"]["content_kind"]
          _limit?: number
        }
        Returns: {
          content_id: string
          views: number
        }[]
      }
      popular_series: {
        Args: { _limit?: number }
        Returns: {
          series_id: string
          views: number
        }[]
      }
      publish_home_draft: {
        Args: { expected_revision: number }
        Returns: number
      }
      report_playback_error: {
        Args: { _event: string; _source_id: string }
        Returns: undefined
      }
      save_home_draft: {
        Args: { c: Json; expected_revision: number }
        Returns: number
      }
      set_primary_playback: { Args: { _source_id: string }; Returns: undefined }
      validate_home_config: { Args: { c: Json }; Returns: undefined }
    }
    Enums: {
      account_status: "active" | "suspended" | "banned"
      app_role: "admin" | "editor" | "user" | "super_admin"
      content_kind: "movie" | "series" | "episode" | "channel"
      content_status: "draft" | "published" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended", "banned"],
      app_role: ["admin", "editor", "user", "super_admin"],
      content_kind: ["movie", "series", "episode", "channel"],
      content_status: ["draft", "published", "archived"],
    },
  },
} as const
