// Supabase生成型（`npm run db:types` = supabase gen types typescript --local の出力に対応）。
// Docker不可の環境で初版を手書きしているため、ローカルスタック起動後に再生成して差分ゼロを確認する
// （CIのdb-testsジョブが生成出力との差分を表示する）。
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      organization_memberships: {
        Row: {
          id: string
          joined_at: string
          member_label: string
          organization_id: string
          role: Database['public']['Enums']['org_role']
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          member_label: string
          organization_id: string
          role?: Database['public']['Enums']['org_role']
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          member_label?: string
          organization_id?: string
          role?: Database['public']['Enums']['org_role']
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          status: Database['public']['Enums']['org_status']
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          status?: Database['public']['Enums']['org_status']
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          status?: Database['public']['Enums']['org_status']
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
          org_id: string
          invited_role?: Database['public']['Enums']['org_role']
        }
        Returns: {
          invitation_id: string
          token: string
          expires_at: string
        }[]
      }
      create_organization: {
        Args: { org_name: string; org_description?: string }
        Returns: string
      }
      is_university_user: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      list_invitations: {
        Args: { org_id: string }
        Returns: {
          id: string
          invited_role: Database['public']['Enums']['org_role']
          created_at: string
          expires_at: string
          state: string
        }[]
      }
      org_member_directory: {
        Args: { org_id: string }
        Returns: {
          member_label: string
          role: Database['public']['Enums']['org_role']
          joined_at: string
          is_self: boolean
        }[]
      }
      preview_invitation: {
        Args: { invitation_token: string }
        Returns: {
          organization_name: string
          invited_role: Database['public']['Enums']['org_role']
          expires_at: string
        }[]
      }
      revoke_invitation: {
        Args: { invitation_id: string }
        Returns: undefined
      }
      update_organization_profile: {
        Args: { org_id: string; new_name: string; new_description: string }
        Returns: undefined
      }
    }
    Enums: {
      org_role: 'owner' | 'admin' | 'member'
      org_status: 'pending' | 'verified' | 'suspended'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
