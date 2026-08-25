export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      organization_memberships: {
        Row: {
          id: string
          joined_at: string
          member_label: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          member_label: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          member_label?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          contact_handle: string
          contact_label: string
          created_at: string
          description: string
          id: string
          name: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          contact_handle?: string
          contact_label?: string
          created_at?: string
          description?: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          contact_handle?: string
          contact_label?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      student_accounts: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      student_passports: {
        Row: {
          available_days: Database["public"]["Enums"]["day_slot"][]
          created_at: string
          experience: Database["public"]["Enums"]["experience_level"]
          frequency: Database["public"]["Enums"]["frequency"]
          interests: Database["public"]["Enums"]["interest_category"][]
          max_fee_per_event_yen: number
          purposes: Database["public"]["Enums"]["purpose"][]
          reception_categories: Database["public"]["Enums"]["interest_category"][]
          reception_paused: boolean
          reception_weekly_limit: number
          style: Database["public"]["Enums"]["activity_style"]
          updated_at: string
          user_id: string
        }
        Insert: {
          available_days: Database["public"]["Enums"]["day_slot"][]
          created_at?: string
          experience: Database["public"]["Enums"]["experience_level"]
          frequency: Database["public"]["Enums"]["frequency"]
          interests: Database["public"]["Enums"]["interest_category"][]
          max_fee_per_event_yen: number
          purposes: Database["public"]["Enums"]["purpose"][]
          reception_categories: Database["public"]["Enums"]["interest_category"][]
          reception_paused?: boolean
          reception_weekly_limit: number
          style: Database["public"]["Enums"]["activity_style"]
          updated_at?: string
          user_id: string
        }
        Update: {
          available_days?: Database["public"]["Enums"]["day_slot"][]
          created_at?: string
          experience?: Database["public"]["Enums"]["experience_level"]
          frequency?: Database["public"]["Enums"]["frequency"]
          interests?: Database["public"]["Enums"]["interest_category"][]
          max_fee_per_event_yen?: number
          purposes?: Database["public"]["Enums"]["purpose"][]
          reception_categories?: Database["public"]["Enums"]["interest_category"][]
          reception_paused?: boolean
          reception_weekly_limit?: number
          style?: Database["public"]["Enums"]["activity_style"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_passports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "student_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { invitation_token: string }
        Returns: {
          organization_id: string
          organization_name: string
        }[]
      }
      create_invitation: {
        Args: {
          invited_role?: Database["public"]["Enums"]["org_role"]
          org_id: string
        }
        Returns: {
          expires_at: string
          invitation_id: string
          token: string
        }[]
      }
      create_organization: {
        Args: { org_description?: string; org_name: string }
        Returns: string
      }
      is_university_user: { Args: never; Returns: boolean }
      list_invitations: {
        Args: { org_id: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          invited_role: Database["public"]["Enums"]["org_role"]
          state: string
        }[]
      }
      list_my_inbox: {
        Args: never
        Returns: {
          beginner_friendly: boolean
          capacity: number
          cautions: string[]
          date_text: string
          deadline: string
          delivered_at: string
          delivery_id: string
          description: string
          event_days: Database["public"]["Enums"]["day_slot"][]
          event_name: string
          fee_per_event_yen: number
          frequency: Database["public"]["Enums"]["frequency"]
          intensity: Database["public"]["Enums"]["activity_style"]
          org_contact_handle: string
          org_contact_label: string
          org_description: string
          org_name: string
          organization_id: string
          place: string
          read_at: string
          reason_note: string
          reasons: string[]
          responded_at: string
          response_choice: Database["public"]["Enums"]["response_choice"]
          score: number
          target_categories: Database["public"]["Enums"]["interest_category"][]
          target_purposes: Database["public"]["Enums"]["purpose"][]
        }[]
      }
      list_org_campaigns: {
        Args: { org_id: string }
        Returns: {
          beginner_friendly: boolean
          capacity: number
          date_text: string
          deadline: string
          delivered_at: string
          delivered_count: number
          delivery_id: string
          description: string
          engaged_count: number
          event_days: Database["public"]["Enums"]["day_slot"][]
          event_name: string
          fee_per_event_yen: number
          frequency: Database["public"]["Enums"]["frequency"]
          intensity: Database["public"]["Enums"]["activity_style"]
          place: string
          planned_count: number
          reason_note: string
          target_categories: Database["public"]["Enums"]["interest_category"][]
          target_purposes: Database["public"]["Enums"]["purpose"][]
          viewed_count: number
        }[]
      }
      mark_offer_read: { Args: { delivery_id: string }; Returns: undefined }
      org_member_directory: {
        Args: { org_id: string }
        Returns: {
          is_self: boolean
          joined_at: string
          member_label: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      preview_invitation: {
        Args: { invitation_token: string }
        Returns: {
          expires_at: string
          invited_role: Database["public"]["Enums"]["org_role"]
          organization_name: string
        }[]
      }
      preview_offer_audience: {
        Args: {
          beginner_friendly: boolean
          capacity: number
          date_text: string
          deadline: string
          description: string
          event_days: Database["public"]["Enums"]["day_slot"][]
          event_name: string
          fee_per_event_yen: number
          frequency: Database["public"]["Enums"]["frequency"]
          intensity: Database["public"]["Enums"]["activity_style"]
          org_id: string
          place: string
          reason_note: string
          target_categories: Database["public"]["Enums"]["interest_category"][]
          target_purposes: Database["public"]["Enums"]["purpose"][]
        }
        Returns: {
          deliverable_count: number
          duplicate_event: boolean
          limited_count: number
          matched_count: number
          sent_this_week: number
          weekly_limit: number
        }[]
      }
      respond_to_offer: {
        Args: {
          choice: Database["public"]["Enums"]["response_choice"]
          delivery_id: string
        }
        Returns: undefined
      }
      revoke_invitation: { Args: { invitation_id: string }; Returns: undefined }
      save_student_passport: {
        Args: {
          available_days: Database["public"]["Enums"]["day_slot"][]
          experience: Database["public"]["Enums"]["experience_level"]
          frequency: Database["public"]["Enums"]["frequency"]
          interests: Database["public"]["Enums"]["interest_category"][]
          max_fee_per_event_yen: number
          purposes: Database["public"]["Enums"]["purpose"][]
          reception_categories: Database["public"]["Enums"]["interest_category"][]
          reception_paused: boolean
          reception_weekly_limit: number
          style: Database["public"]["Enums"]["activity_style"]
        }
        Returns: undefined
      }
      send_offer: {
        Args: {
          beginner_friendly: boolean
          capacity: number
          date_text: string
          deadline: string
          description: string
          event_days: Database["public"]["Enums"]["day_slot"][]
          event_name: string
          fee_per_event_yen: number
          frequency: Database["public"]["Enums"]["frequency"]
          intensity: Database["public"]["Enums"]["activity_style"]
          org_id: string
          place: string
          reason_note: string
          target_categories: Database["public"]["Enums"]["interest_category"][]
          target_purposes: Database["public"]["Enums"]["purpose"][]
        }
        Returns: {
          deliverable_count: number
          delivery_id: string
          limited_count: number
          matched_count: number
        }[]
      }
      update_organization_contact: {
        Args: { new_handle: string; new_label: string; org_id: string }
        Returns: undefined
      }
      update_organization_profile: {
        Args: { new_description: string; new_name: string; org_id: string }
        Returns: undefined
      }
    }
    Enums: {
      activity_style: "relaxed" | "moderate" | "serious"
      day_slot: "weekday_day" | "weekday_night" | "weekend"
      experience_level: "none" | "some" | "experienced"
      frequency: "monthly_1_2" | "weekly_1" | "weekly_2_plus"
      interest_category:
        | "outdoor"
        | "photo"
        | "travel"
        | "music"
        | "sports"
        | "film"
        | "volunteer"
        | "international"
      org_role: "owner" | "admin" | "member"
      org_status: "pending" | "verified" | "suspended"
      purpose: "friends" | "challenge" | "exercise" | "creation"
      response_choice: "interested" | "thinking" | "skip"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_style: ["relaxed", "moderate", "serious"],
      day_slot: ["weekday_day", "weekday_night", "weekend"],
      experience_level: ["none", "some", "experienced"],
      frequency: ["monthly_1_2", "weekly_1", "weekly_2_plus"],
      interest_category: [
        "outdoor",
        "photo",
        "travel",
        "music",
        "sports",
        "film",
        "volunteer",
        "international",
      ],
      org_role: ["owner", "admin", "member"],
      org_status: ["pending", "verified", "suspended"],
      purpose: ["friends", "challenge", "exercise", "creation"],
      response_choice: ["interested", "thinking", "skip"],
    },
  },
} as const

